# Labeled, Structured Notation

A notation for expressing data structures and a superset of JSON. The novel
idea is to generalize the concept of a 'label' found in JSON objects using a
`:` (e.g., `"label": true`) to be made available in all data structures. The
goal is to define a Lisp based configuration language that would act as a JSON+
option. Kind of like YAML but going in a lisp direction and definitely not
towards significant whitespace.

Ideally, I like the simplicity of S-Expressions in Lisp. Practically, I like
the semantic meaning of square and curly brackets and I view labels as another
(hopefully practical) concession of adding a little more syntax to Lisp. This
is the last time we'd need to add syntax I promise!

An interesting benefit of adding `:` labeling syntax is that JSON is a proper
subset of LSN. Like how JSON is a subset of YAML.

The lisp implementation was heavily influenced by Joel Martin's
MAL project: https://github.com/kanaka/mal

## Running
To run an LSN repl, run this command: `npm start` or `pnpm start` or
`node src/repl.js`.

This is still just a crude experiment at the moment.

## Syntax Notes
See the EBNF grammar for specifics on syntax: [src/lsn.ebnf.w3c](src/lsn.ebnf.w3c).

1. Label Infix Operator:
    1. Additional syntax layered on top of Clojure syntax layered on Lisp
    2. Added with an infix `:` operator.
    3. `:` may occur anywhere and is just syntax sugar around a 'label' form: `a:1` ==> `(label a 1)`.
    4. `:` has right to left precedence with itself: `a:b:1` ==> `(label a (label b 1))`
    5. `:` will be the _only_ infix syntax to be added ever. Having just one infix
     operator means the precendence rules will not be _too_ horrible. As it is, even just one was suprisingly messy.
2. Prefix Operators: A few symbols will be dedicated for use in prefix syntax:
    1. `#`, `...`, `$`, `\` are all prefix, unary operators
    2. `#`, `...` both bind more loosely than `:`: `#a:1` ==> `(comment (label a 1))`
       applies to the entire `a:1` form).
    3. `$`, `\` both bind more tightly than `:`: `$a:1` ==> `(label (expand a) 1)`
3. Reserved characters: Characters used by prefix and infix operators are reserved and not allowed in other of other symbols.
   I.e. a `#` can only mean the prefix symbol.
    * Exception: `.` also appears in floating point numbers.
4. Strings only support `"` delimiters.
    * For now? I'm guessing some fancy string interpolation would be nice.
5. Easy for both humans and computers to read:
    1. No sigificant whitespace: None. Not even comment lines.
    2. Commas and semicolons are just whitespace (and may not be used as part of symbols)
    3. Small set of operaters. the above infix operator and four prefix operators should be it.
6. Syntax derived from the following sources:
    1. Javascript syntax: `:`, `...`, `[]`, `{}`
    2. Shell syntax: `#`, `$` `\`
    3. Clojure syntax: `[]` `{}`
    4. The rest of the syntax is just Lisp: `()`

## Semantics Notes
1. Each syntax operator corresponds to exactly one lisp special form. This means parsing
   the syntax is just the process of replacing the syntax with the following
   forms:

| Syntax | Lisp Form |
| --- | --- |
| `#x` | `(comment x)` |
| `x:1` | `(label x 1)` |
| `$x` | `(expand x)` |
| `\x` | `(quote x)` |
| `...x` | `(spread x)` |
| `[x y z]` | `(list x y z)` |
| `{x y z}` | `(set x y z)` |
| `(x y z)` | `(x y z)` |

2. Only two kinds of collections: ordered (lists) and unordered (sets).
   Maps are a special case of sets. Parens are a special case of lists.
3. label forms are special forms and evaluate into useful values for
   associating labels to values.
4. Symbols are first class values and evaluate to themselves (and then possibly expanded into a new value).
5. Symbols are expanded (resolved) everywhere _except_ in the left hand side of
   a label.
6. No keywords. Since symbols are conviently not expanded in a label form,
   maybe
   we don't need them.

## A Brief tour of LSL syntax and semantics

### Simple Values

    #"comment string" #"Does nothing"
    1, -30.1          #"numbers (comma is whitespace)"
    true false        #"boolean values"
    "a" "b"           #"strings"
    null undefined    #"null & undefined"
    \symbol           #"symbol literal (using \ syntax)"
    #23               #"number commented out"

### Labeled Values

    x: 3              #"number labeled with symbol x"
    $x                #"symbol x expanded to 3"
    x                 #"symbols expand automatically"
    34: true          #"true labeled with number 34"
    $34               #"number 34 expanded to true"
    a: b: 3.14        #"labels can be chained"

### Collection Values

    [1 2 3 4]         #"ordered collection (list)"
    {1 2 3 4}         #"unordered collection (set)"
    {a:1 b:2}         #"unordered, labeled collection (map)"
    {a:1 3 4}         #"unordered, partially labeled collection (map & set)"
    [0:1 1:2]         #"list of labeled values"

### Function Calls

    v: (+ 1 2)        #"+ function sums numbers"
    (- 9 v)           #"- function subtracts them"
    (conj {1 2} 3)    #"conj adds values to unordered collections"
    (conj [1 2] 3)    #"or to the end of ordered collections"
    z: (conj {1} b:2) #"conj also adds labeled values"
    (get z \b)        #"get will look up values by their labels"
    (get z 1)         #"unlabeled values are implicitly labeled as themselves."
    (get [-1 -2] 1)   #"ordered collections have implicit index labels"
