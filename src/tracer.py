import sys
import json
import types

class ExecutionTracer:
    def __init__(self, max_steps=2000):
        self.trace_data = []
        self.step_count = 0
        self.max_steps = max_steps

    def trace_calls(self, frame, event, arg):
        if event == 'line':
            self.step_count += 1
            if self.step_count > self.max_steps:
                sys.settrace(None)
                raise RuntimeError(f"Execution halted: Exceeded {self.max_steps} steps.")

            locals_dict = {
                k: repr(v) for k, v in frame.f_locals.items() 
                if not k.startswith('__')
                if type(v) is not types.FunctionType
            }

            depth = 0
            curr = frame
            while curr:
                depth += 1
                curr = curr.f_back

            self.trace_data.append({
                "line": frame.f_lineno,
                "vars": locals_dict,
                "depth": depth,
            })
            
        return self.trace_calls 

def execute_and_trace(user_code):
    tracer = ExecutionTracer()
    user_namespace = {}
    
    sys.settrace(tracer.trace_calls)
    try:
        exec(user_code, user_namespace)
    except Exception as e:
        tracer.trace_data.append({"error": str(e), "line": -1, "vars": {}})
    finally:
        sys.settrace(None)
        
    return json.dumps(tracer.trace_data)