'use strict'

const fs = require('fs')
const path = require('path')

const im = require('immutable')
const chalk = require('chalk')

const ebnf = require('ebnf')

const lsnParser = new ebnf.Grammars.W3C.Parser(fs.readFileSync(path.resolve(__dirname, 'lsn.ebnf.w3c')).toString())

const Symbol2 = im.Record({ sym: null }, 'Symbol2')
const symbol = sym => Symbol2({ sym })
const sym = Object.fromEntries([
  'activeEval',
  'bind',
  'comment',
  'complement',
  'do',
  'env',
  'error',
  'eval',
  'expand',
  'fn',
  'list',
  'quote',
  'read',
  'set',
  '_'
].map(x => [x, symbol(x)]))

const getMeta = x => x[Symbol.for('metadata')] || im.Map()
const setMeta = (x, m) => {
  x[Symbol.for('metadata')] = im.Map(m)
  return x
}
const alterMeta = (x, m) => {
  return setMeta(x, getMeta(x).merge(im.Map(m)))
}

// const isCallable = x => x instanceof Function
const isSymbol = x => x instanceof Symbol2
const isList = x => im.List.isList(x)
const isCall = (x) => isList(x) && getMeta(x).get('call', false)
const isBind = (x) => isList(x) && getMeta(x).get('bind', false)
const isSet = x => im.Map.isMap(x)

const list = (xs) => setMeta(im.List(xs), {})
const call = xs => setMeta(im.List(xs), { call: true })
const set = xs => im.Map(xs)
const bind = (k, v) => setMeta(im.List([k, v]), { bind: true })
const doForm = (xs) => call([sym.do, ...xs])

//
// Read Section
//

function walkAST (ast, rules) {
  if (!(ast.type in rules)) {
    throw new Error(`Unknown AST Type: ${ast.type}`)
  }
  return rules[ast.type](ast, rules)
}

const children = (ast, rules) => call(ast.children.map(child => walkAST(child, rules)))
const child = (ast, rules) => children(ast, rules).first()
const sexpr = (type, f) => (ast, rules) => call([type, ...(f(ast, rules) || [])])

const readRules = {
  forms: children,
  form1: child,
  form2: child,
  form3: child,
  form4: child,

  comment: sexpr(sym.comment, children),
  bind: sexpr(sym.bind, children),
  expand: sexpr(sym.expand, children),
  quote: sexpr(sym.quote, children),
  round: child,
  square: sexpr(sym.list, child),
  curly: sexpr(sym.set, child),
  complement: sexpr(sym.complement, children),

  number: ast => parseFloat(ast.text),
  string: ast => ast.text,
  boolean: ast => ast.text === 'true',
  null: ast => null,
  undefined: ast => undefined,
  symbol: ast => sym[ast.text] || symbol(ast.text)
}

function read (str) {
  const ast = lsnParser.getAST(str)

  if (!ast) {
    throw new Error('Failed to parse input')
  }

  return walkAST(ast, readRules)
}

//
// Evaluation Section
//

function evalActiveRest (exp, env) {
  return exp
    .rest()
    .map(exp => env.get(sym.activeEval)(exp, env))
}

function evalList (exp, env) {
  return list(evalActiveRest(exp, env))
}

function evalBind (exp, env) {
  return bind(
    exp.get(1),
    env.get(sym.activeEval)(exp.get(2), env))
}

function unchainBind (leftVals, rightVal) {
  if (isBind(rightVal)) {
    return unchainBind(leftVals.push(rightVal.first()), rightVal.last())
  } else {
    return leftVals.map(leftVal => bind(leftVal, rightVal))
  }
}

function normalizeBinds (binds) {
  return binds
    .map(val => isBind(val) ? val : bind(val, val))
    .map(val => unchainBind(im.List(), val))
    .reduce((a, b) => a.concat(b))
}

function evalSet (exp, env) {
  return set(normalizeBinds(evalActiveRest(exp, env)))
}

function evalExpand (exp, env) {
  return env.get(evalExp(exp.get(1), env))
}

function evalQuote (exp, env) {
  return exp.get(1)
}

function evalExp (exp, env) {
  try {
    return isCall(exp)
      ? evalSymExp(exp.first(), env)(exp, env)
      : exp
  } catch (e) {
    e.message = `${exp.first()} is not a function`
    throw e
  }
}

function evalSymExp (exp, env) {
  return isSymbol(exp)
    ? env.get(exp, exp === sym.env ? env : null)
    : evalExp(exp, env)
}

function evalFn (expWhenDefined, envWhenDefined) {
  return (expWhenCalled, envWhenCalled) => {
    return evalDo(
      doForm([
        bind(sym.args, evalSymExp(expWhenCalled, envWhenCalled)),
        expWhenDefined.last()
      ]),
      envWhenDefined)
  }
}

function updateEnv (env, val) {
  return normalizeBinds(list([bind(sym._, val)]))
    .reduce((env, val) => env.set(val.first(), val.last()), env)
}

function evalDo (exp, env) {
  return exp
    .rest()
    .reduce((env, form) =>
      updateEnv(env, evalSymExp(form, env)), env)
    .get(symbol('_'))
}

function evalBody (state, exp) {
  const val = evalSymExp(exp, state.env)
  return state
    .update('vals', vals => vals.push(val))
    .update('env', env => {
      env = env.update('expTotal', expTotal => expTotal + 1)
      return updateEnv(env, bind(env.get('expTotal'), val))
    })
}

function evaluate (state, exps) {
  return exps
    .reduce(evalBody, state.set('vals', im.List()))
    .set('exps', exps)
    .update('expTotal', n => n + exps.count())
}

//
// Print Section
//

function printChildren (exp, n, sep = ' ') {
  return exp
    .slice(n)
    .map((_, i) => printChild(exp, n + i))
    .join(sep)
}

const expType = exp =>
  isCall(exp) ? 'call'
    : isBind(exp) ? 'bind'
      : isList(exp) ? 'list'
        : isSet(exp) ? 'set'
          : isSymbol(exp) ? 'symbol'
            : typeof exp

function printChild (parentExp, i) {
  const childExp = parentExp.get(i)
  let format = null

  if (format) {
    // This block of pretty printing is disabled for now
    if (child === sym.comment && (parentExp !== sym.bind || i !== 1)) {
      format = x => chalk.dim.strikethrough('#' + printChildren(x, 1))
    } else if (child === sym.complement && childExp.getIn([0, 1]) === sym.set) {
      format = x => chalk.cyan('-') + printChildren(x, 1)
    }
  } else {
    format = {
      bind: x => printChildren(x, 0, chalk.cyan(': ')),
      call: x => chalk.cyan('(') + printChildren(x, 0) + chalk.cyan(')'),
      list: x => chalk.cyan('[') + printChildren(x, 0) + chalk.cyan(']'),
      set: x => (
        chalk.cyan('{') +
        printChildren(x.entrySeq().map(([k, v]) =>
          im.is(k, v) ? v : bind(k, v)), 0) +
        chalk.cyan('}')),
      expand: x => chalk.cyan('$') + printChildren(x, 1),
      quote: x => chalk.cyan('\\') + printChildren(x, 1),
      boolean: chalk.yellow,
      number: chalk.yellow,
      string: chalk.green,
      symbol: x => (sym[x] ? chalk.blue.bold : chalk.blue)(x.sym),
      undefined: chalk.yellow,
      object: chalk.yellow
    }[expType(childExp)] || (exp => exp)
  }

  return format(childExp)
}

function print (exps, expTotal = 0) {
  return printChildren(exps.map((exp, i) => bind(expTotal + i, exp)), 0, '\n')
}

//
// REP Loop
//

function evalRead (exp, env) {
  return read(evalSymExp(exp.get(1), env).slice(1, -1)).first()
}

function evalEval (exp, env) {
  return evalSymExp(
    exp.get(1),
    evalSymExp(exp.get(2), env))
}

function evalRest (exp, env) {
  return exp
    .rest()
    .map(exp => evalSymExp(exp, env))
}

let replState = im.Record({
  env: im.Map([
    [sym.comment, (exp, env) => exp],
    [sym.bind, evalBind],
    [sym.read, evalRead],
    [sym.eval, evalEval],
    [sym.expand, evalExpand],
    [sym.list, evalList],
    [sym.quote, evalQuote],
    [sym.set, evalSet],
    [sym.activeEval, evalSymExp],
    [sym.fn, evalFn],
    [symbol('+'), (exp, env) => evalRest(exp, env).reduce((total, x) => total + x)],
    [symbol('-'), (exp, env) => evalRest(exp, env).reduce((total, x) => total - x)],
    [symbol('*'), (exp, env) => evalRest(exp, env).reduce((total, x) => total * x)],
    [symbol('/'), (exp, env) => evalRest(exp, env).reduce((total, x) => total / x)],
    [symbol('normalizeBinds'), (exp, env) => list(normalizeBinds(evalRest(exp, env)))],
    [symbol('='), (exp, env) => {
      const vals = evalRest(exp, env)
      return im.is(vals.get(0), vals.get(1))
    }],
    [symbol('inc'), (exp, env) => 1 + evalRest(exp, env).first()],
    [symbol('get'), (exp, env) => {
      const [s, k] = evalRest(exp, env)
      return s.get(k)
    }],
    [symbol('add'), (exp, env) => {
      const vals = evalRest(exp, env)
      return normalizeBinds(vals.rest())
        .reduce((s, binding) => s.set(binding.first(), binding.last()), vals.first())
    }],
    [sym.do, evalDo],
    ['unquotedForms', im.Set([sym.bind, sym.list, sym.set])],
    ['expTotal', 0]
  ]),
  exps: im.List(),
  vals: im.List()
})()

function rep (str) {
  try {
    const exps = read(str)
    replState = evaluate(replState, exps)
    const out = print(replState.vals, replState.env.get('expTotal'))
    return out
  } catch (e) {
    console.dir(e)
    return printChildren(list([bind(sym.error, `"${e.message}"`)]), 0)
  }
}

module.exports = {
  alterMeta,
  bind,
  call,
  isCall,
  isList,
  list,
  rep,
  replState,
  sym
}
