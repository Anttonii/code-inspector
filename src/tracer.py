import ast
import json
import sys
import traceback
from collections import defaultdict
from dataclasses import asdict, dataclass, is_dataclass
from typing import Any, Dict, List, Union


class EnhancedJSONEncoder(json.JSONEncoder):
    def default(self, o):
        if is_dataclass(o):
            return asdict(o)
        if isinstance(o, ExecutionTracer):
            return o.to_json()
        return super().default(o)


@dataclass(frozen=True)
class ConditionalStatement:
    left: str
    right: str
    op: str
    type: str = "compare"

    def __str__(self) -> str:
        return f"{self.left} {self.op} {self.right}"


@dataclass(frozen=True)
class BoolCondition:
    operator: str
    conditions: List[Union["BoolCondition", ConditionalStatement]]
    type: str = "bool"

    def __str__(self) -> str:
        return f" {self.operator} ".join(str(c) for c in self.conditions)


@dataclass(frozen=True)
class TraceStep:
    line: int
    vars: Dict[str, Any]
    depth: int
    frame_id: int
    parent_frame_id: int | None
    func_name: str
    conditional: BoolCondition | ConditionalStatement | None

@dataclass(frozen=True)
class ErrorInfo:
    line: int
    message: str

@dataclass(frozen=True)
class TracerData:
    steps: List[TraceStep]
    untracked_vars: List[str]
    error: ErrorInfo | None = None

class NodeVisitor(ast.NodeVisitor):
    def __init__(self):
        self.conditionals = defaultdict(dataclass)
        self.untracked_lines = set()

    def parse_condition(
        self, node: ast.AST
    ) -> Union[ConditionalStatement, BoolCondition]:
        op_map = {
            ast.Eq: "==",
            ast.NotEq: "!=",
            ast.Lt: "<",
            ast.LtE: "<=",
            ast.Gt: ">",
            ast.GtE: ">=",
            ast.Is: "is",
            ast.IsNot: "is not",
            ast.In: "in",
            ast.NotIn: "not in",
        }

        if isinstance(node, ast.Compare):
            op_str = op_map.get(type(node.ops[0]), "?")
            return ConditionalStatement(
                left=ast.unparse(node.left),
                right=ast.unparse(node.comparators[0]),
                op=op_str,
            )
        elif isinstance(node, ast.BoolOp):
            op_str = "and" if isinstance(node.op, ast.And) else "or"
            conditions = [self.parse_condition(value) for value in node.values]
            return BoolCondition(operator=op_str, conditions=conditions)
        else:
            raise ValueError(f"Unsupported AST node type: {type(node)}")

    def visit_While(self, node):
        line_no = node.lineno
        test = node.test

        self.conditionals[line_no] = self.parse_condition(test)
        self.generic_visit(node)

    def visit_If(self, node):
        test = node.test
        line_no = node.lineno

        self.conditionals[line_no] = self.parse_condition(test)
        self.generic_visit(node)

    def visit_Call(self, node):
        if isinstance(node.func, ast.Name) and node.func.id == "untrack":
            self.untracked_lines.add(node.lineno)

        self.generic_visit(node)


class ExecutionTracer:
    def __init__(self, analyzer: NodeVisitor, max_steps: int = 2000):
        self.trace_data = []
        self.step_count = 0
        self.max_steps = max_steps
        self.analyzer = analyzer
        self.untracked_vars = set()
        self.error = None

        self.frame_to_id = {}
        self.next_frame_id = 0

    def _copy_or_pass(self, v: Any):
        if isinstance(v, list):
            return list(v)
        if isinstance(v, dict):
            return dict(v)
        return v

    def trace_calls(self, frame, event, arg):
        if event == "call":
            if frame.f_code.co_name == "untrack_vars":
                return None

        if event == "line":
            line_no = frame.f_lineno
            if line_no in self.analyzer.untracked_lines:
                return self.trace_calls

            self.step_count += 1
            if self.step_count > self.max_steps:
                sys.settrace(None)
                raise RuntimeError(
                    f"Execution halted: Exceeded {self.max_steps} steps."
                )

            locals_dict = {
                k: self._copy_or_pass(v)
                for k, v in frame.f_locals.items()
                if not k.startswith("__")
                if not callable(v)
            }

            depth = 0
            curr = frame

            while curr:
                depth += 1
                curr = curr.f_back
            
            if frame not in self.frame_to_id:
                self.frame_to_id[frame] = self.next_frame_id
                self.next_frame_id += 1
            
            current_frame_id = self.frame_to_id[frame]
            func_name = frame.f_code.co_name

            parent_frame_id = None
            if frame.f_back and frame.f_back in self.frame_to_id:
                parent_frame_id = self.frame_to_id[frame.f_back]

            conditional = None
            if line_no in self.analyzer.conditionals:
                conditional = self.analyzer.conditionals[line_no]

            call_trace = TraceStep(
                line=line_no,
                vars=locals_dict,
                depth=depth,
                func_name=func_name,
                frame_id=current_frame_id,
                parent_frame_id=parent_frame_id,
                conditional=conditional,
            )

            self.trace_data.append(call_trace)

        return self.trace_calls
    
    def untrack_vars(self, *var_names):
        for name in var_names:
            self.untracked_vars.add(str(name))

    def clear(self) -> None:
        self.trace_data = []
        self.step_count = 0
        self.untracked_vars = set()
        self.error = None

    def set_error(self, error: ErrorInfo) -> None:
        self.error = error

    def to_json(self) -> TracerData:
        return TracerData(
            steps=self.trace_data,
            untracked_vars=list(self.untracked_vars),
            error=self.error
        )

def execute_and_trace(user_code):
    analyzer = NodeVisitor()
    tracer = ExecutionTracer(analyzer=analyzer)

    try:
        tree = ast.parse(user_code, mode="exec")
        analyzer.visit(tree)
    except SyntaxError as e:
        sys.settrace(None)
        err_line = e.lineno or -1
        
        tracer.set_error(ErrorInfo(message=traceback.format_exc(), line=err_line))
        return json.dumps(
            tracer,
            cls=EnhancedJSONEncoder,
        )

    sys.settrace(tracer.trace_calls)
    user_namespace = {
        "untrack": tracer.untrack_vars
    }
    try:
        exec(user_code, globals=user_namespace)
    except Exception as e:
        # Assert we don't trace the actual error backtrace
        sys.settrace(None)

        tb = e.__traceback__
        err_line = -1
        while tb:
            # Code executed via exec() gets assigned the filename '<string>'
            if tb.tb_frame.f_code.co_filename == "<string>":
                err_line = tb.tb_lineno
            tb = tb.tb_next

        tracer.clear()
        tracer.set_error(ErrorInfo(message=traceback.format_exc(), line=err_line))
    finally:
        sys.settrace(None)

    return json.dumps(tracer, cls=EnhancedJSONEncoder)
