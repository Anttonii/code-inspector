## TODO

### Days thoughts 15/07/2026

- [x] Move steps forward and backward with key presses
- [x] Move the inspector pane to the right of the code editor
- [x] Configure line wrapping for the code editor
- [ ] Untrack should only hide the untracked variables from inspector pane, not remove them from recorded vars

### Days thoughts 14/07/2026

- [x] Add a global function `untrack` that allows the untracking of given variables
- [x] Handle conditionals such that in debugging mode show the conditioanl evaluation on the line
  - [x] Parse the AST and record conditionals.
  - [x] Evaluate conditionals in the frontend (?)
    - [x] Evaluate array indexing
  - [x] Show the result of the evaluation on the same line as the conditional with green check mark or red cross

### Days thoughts 13/07/2026

- [x] Handle Python errors gracefully and provide the stacktrace.
  - [x] Show the user the stacktrace
  - [x] Highlight the line that caused the error
- [ ] Add compact mode that contains the operations of a single loop execution.
  - [ ] It should additionally handle function calls
- [x] Improve the overall look and feel
