
# V8 Tokens

Tokens are the first thing V8 produces from your source code. The scanner (lexer) reads raw characters and groups them into meaningful chunks — keywords, operators, identifiers, literals, punctuation. This happens before parsing, before the AST, before anything else. The scanner's `Scanner::Next()` function in `src/parsing/scanner.cc` is where this lives, and if you want to see what tokens your code produces, you can add a print statement there:

```c
printf("token: %s\n", Token::Name(current().token));
```

In example 1, we ran our simple `add` function through the scanner and piped the output through `sort | uniq` to see all the unique token types. Here's what came out, organized by category.

## Keywords

These are reserved words in JavaScript that the scanner recognizes as special:

```
kFunction    — the "function" keyword
kLet         — the "let" keyword (also kConst, kVar for other declaration types)
kReturn      — the "return" keyword
```

Every keyword has its own token type. The scanner doesn't just say "this is an identifier" — it distinguishes `function` from a variable named `function`. This is what makes keywords reserved.

## Operators

```
kAdd         — the "+" operator
kAssign      — the "=" operator
```

These map directly to the AST node types we see later. `kAdd` in the token stream becomes a kAdd binary operation in the AST. The scanner just identifies the character(s), the parser decides what they mean in context (is `+` binary addition or unary plus?).

## Literals and identifiers

```
kSmi         — a small integer literal (like 1, 2, 42)
kIdentifier  — a variable name, function name, or property name
```

`kSmi` is interesting — the scanner already knows this is a small integer, not just "some number." V8 distinguishes Smis from other numeric literals at the very first stage of processing. Identifiers are everything else that looks like a name: `add`, `x`, `print`, `a`, `b`.

## Punctuation and structure

```
kLeftParen   — "("
kRightParen  — ")"
kLeftBrace   — "{"
kRightBrace  — "}"
kComma       — ","
kSemicolon   — ";"
```

These define the structure of the code. Braces delimit function bodies and blocks, parentheses wrap parameters and arguments, commas separate items in lists, semicolons terminate statements.

## What tokens tell you

Honestly, the token stage is the least interesting part of the pipeline for our purposes. The scanner is doing mechanical work — it doesn't make decisions about meaning, optimization, or execution. But it's worth seeing once because it confirms that V8 processes your code in distinct stages: characters become tokens, tokens become an AST, the AST becomes bytecode, and so on.

As you move through more examples, the token list grows. Example 3 (objects) adds colon and dot tokens. Example 4 (constructors) adds `kNew` and `kThis`. But the pattern is always the same — each new JavaScript feature introduces a handful of new token types, and the scanner handles them the same way it handles everything else.

The real action starts at the AST stage. That's where the parser takes these flat tokens and builds a tree that represents the structure and meaning of your code.
