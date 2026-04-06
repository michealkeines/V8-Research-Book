
```
as we saw in the bytecode generated, all the function have FBV, which collects feedback for the pparticular function

in the first run it wil be set to UNINTIALIZED

after ht first observation MONOMORPHIC

if multiple types hit the same variable, it will be set to POLYMORPHIC

if there lot of type, thne MEGAMORPHIC


we also have EmbeddedFeedback Vector that collect feedback at instrucction level for conditioon jumps

it will give type hints for the operations


EG:

EmbeddedFeedback[] give out like "i variable is always SMI"

FBV[] give out like "this loop always returns SMI"

```