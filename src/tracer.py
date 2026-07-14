import sys
import json
import types
import ast
from collections import defaultdict
from dataclasses import dataclass, asdict, is_dataclass
from typing import List, Union


class EnhancedJSONEncoder(json.JSONEncoder):
    def default(self, o):
        if is_dataclass(o):
            return asdict(o)
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


@dataclass()
class TraceStep:
    line: int
    vars: dict
    depth: int
    error: str | None = None
    conditional: BoolCondition | ConditionalStatement | None = None


class NodeVisitor(ast.NodeVisitor):
    def __init__(self):
        self.conditionals = defaultdict(dataclass)

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


class ExecutionTracer:
    def __init__(self, analyzer: NodeVisitor, max_steps: int = 2000):
        self.trace_data = []
        self.step_count = 0
        self.max_steps = max_steps
        self.analyzer = analyzer

    def trace_calls(self, frame, event, arg):
        if event == "line":
            self.step_count += 1
            if self.step_count > self.max_steps:
                sys.settrace(None)
                raise RuntimeError(
                    f"Execution halted: Exceeded {self.max_steps} steps."
                )

            locals_dict = {
                k: repr(v)
                for k, v in frame.f_locals.items()
                if not k.startswith("__")
                if type(v) is not types.FunctionType
            }

            depth = 0
            curr = frame
            line_no = frame.f_lineno

            while curr:
                depth += 1
                curr = curr.f_back

            call_trace = TraceStep(
                line=line_no,
                vars=locals_dict,
                depth=depth,
                error=None,
                conditional=None,
            )

            if line_no in self.analyzer.conditionals:
                call_trace.conditional = self.analyzer.conditionals[line_no]

            self.trace_data.append(call_trace)

        return self.trace_calls


def execute_and_trace(user_code):
    analyzer = NodeVisitor()
    try:
        tree = ast.parse(user_code, mode="exec")
        analyzer.visit(tree)
    except SyntaxError:
        pass  # Let exec() throw the actual error so we can catch it normally

    tracer = ExecutionTracer(analyzer=analyzer)
    user_namespace = {}

    sys.settrace(tracer.trace_calls)
    try:
        exec(user_code, user_namespace)
    except Exception as e:
        tracer.trace_data.append(TraceStep(line=-1, vars={}, error=str(e), depth=0))
    finally:
        sys.settrace(None)

    return json.dumps(tracer.trace_data, cls=EnhancedJSONEncoder)
