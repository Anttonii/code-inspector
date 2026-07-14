import sys
import json
import types
import ast
from collections import defaultdict
from dataclasses import dataclass, asdict
from typing import List, Union


@dataclass(frozen=True)
class ConditionalStatement:
    left: str
    right: str
    op: str

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, json_str: str) -> "ConditionalStatement":
        data = json.loads(json_str)
        return cls(**data)

    def __str__(self) -> str:
        return f"{self.left} {self.op} {self.right}"


@dataclass(frozen=True)
class BoolCondition:
    operator: str
    conditions: List[Union["BoolCondition", ConditionalStatement]]

    def to_json(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def from_json(cls, json_str: str) -> "BoolCondition":
        data = json.loads(json_str)
        conditions = []
        for cond in data["conditions"]:
            if "operator" in cond and "conditions" in cond:
                conditions.append(BoolCondition.from_json(json.dumps(cond)))
            else:
                conditions.append(ConditionalStatement(**cond))
        return cls(operator=data["operator"], conditions=conditions)

    def __str__(self) -> str:
        return f" {self.operator} ".join(str(c) for c in self.conditions)


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

    def visit_If(self, node):
        test = node.test
        line_no = node.lineno
    
        self.conditionals[line_no] = self.parse_condition(test)


class ExecutionTracer:
    def __init__(self, max_steps=2000):
        self.trace_data = []
        self.step_count = 0
        self.max_steps = max_steps

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
            while curr:
                depth += 1
                curr = curr.f_back

            self.trace_data.append(
                {
                    "line": frame.f_lineno,
                    "vars": locals_dict,
                    "depth": depth,
                }
            )

        return self.trace_calls


def execute_and_trace(user_code):
    tracer = ExecutionTracer()
    user_namespace = {}

    analyzer = NodeVisitor()
    try:
        tree = ast.parse(user_code)
        analyzer.visit(tree)
    except SyntaxError:
        pass  # Let exec() throw the actual error so we can catch it normally

    sys.settrace(tracer.trace_calls)
    try:
        exec(user_code, user_namespace)
    except Exception as e:
        tracer.trace_data.append({"error": str(e), "line": -1, "vars": {}})
    finally:
        sys.settrace(None)

    return json.dumps(tracer.trace_data)
