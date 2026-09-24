import Base
import ./tree.bend as T
import ./LAWS.bend as Laws

def Laws.mirror_involutive(t):
  match t:
    case T.Leaf{v}:
      {==}
    case T.Node{+l, +r}:
      %Laws.mirror_involutive(l) : {T.Node{T.mirror(T.mirror(l)), T.mirror(T.mirror(r))} == T.Node{_, r} : T.Tree}
      %Laws.mirror_involutive(r) : {T.Node{T.mirror(T.mirror(l)), T.mirror(T.mirror(r))} == T.Node{T.mirror(T.mirror(l)), _} : T.Tree}
      {==}

# ---- Nat arithmetic lemmas (Base ships none, so we prove our own) ----

law add_zero:
  for a: Nat
  {Nat.add(a, 0n) == a : Nat}

def add_zero(a):
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_zero(p) : {1n+Nat.add(p, 0n) == 1n+_ : Nat}
      {==}

law succ_add:
  for a: Nat
  for b: Nat
  {1n+Nat.add(a, b) == Nat.add(a, 1n+b) : Nat}

def succ_add(a, b):
  match a:
    case 0n:
      {==}
    case 1n+p:
      %succ_add(p, b) : {2n+Nat.add(p, b) == 1n+_ : Nat}
      {==}

law add_comm:
  for +a: Nat
  for +b: Nat
  {Nat.add(a, b) == Nat.add(b, a) : Nat}

def add_comm(a, b):
  match a:
    case 0n:
      %add_zero(b) : {_ == Nat.add(b, 0n) : Nat}
      {==}
    case 1n+p:
      %succ_add(b, p) : {1n+Nat.add(p, b) == _ : Nat}
      %add_comm(p, b) : {1n+Nat.add(p, b) == 1n+_ : Nat}
      {==}

law add_assoc:
  for a: Nat
  for -b: Nat
  for -c: Nat
  {Nat.add(a, Nat.add(b, c)) == Nat.add(Nat.add(a, b), c) : Nat}

def add_assoc(a, b, c):
  match a:
    case 0n:
      {==}
    case 1n+p:
      %add_assoc(p, b, c) : {1n+Nat.add(p, Nat.add(b, c)) == 1n+_ : Nat}
      {==}

# ---- List lemmas ----

law length_append:
  for xs: +List<Nat>
  for ys: +List<Nat>
  {List.length(&2, Nat, List.append(&2, Nat, xs, ys)) == Nat.add(List.length(&2, Nat, xs), List.length(&2, Nat, ys)) : Nat}

def length_append(xs, ys):
  match xs:
    case Nil{}:
      {==}
    case h <> t:
      %length_append(t, ys) : {1n+List.length(&2, Nat, List.append(&2, Nat, t, ys)) == 1n+_ : Nat}
      {==}

law sum_append:
  for xs: +List<Nat>
  for ys: +List<Nat>
  {T.list_sum(List.append(&2, Nat, xs, ys)) == Nat.add(T.list_sum(xs), T.list_sum(ys)) : Nat}

def sum_append(xs, ys):
  match xs:
    case Nil{}:
      {==}
    case h <> t:
      %add_assoc(h, T.list_sum(t), T.list_sum(ys)) : {Nat.add(h, T.list_sum(List.append(&2, Nat, t, ys))) == _ : Nat}
      %sum_append(t, ys) : {Nat.add(h, T.list_sum(List.append(&2, Nat, t, ys))) == Nat.add(h, _) : Nat}
      {==}

# L = +List<Nat>, and `rev` below is Base's accumulator-based List.reverse.

law app_nil:
  for +xs: +List<Nat>
  {List.append(&2, Nat, xs, Nil{}) == xs : +List<Nat>}

def app_nil(xs):
  match xs:
    case Nil{}:
      {==}
    case h <> t:
      %app_nil(t) : {h <> List.append(&2, Nat, t, Nil{}) == h <> _ : +List<Nat>}
      {==}

law app_assoc:
  for +xs: +List<Nat>
  for +ys: +List<Nat>
  for +zs: +List<Nat>
  {List.append(&2, Nat, xs, List.append(&2, Nat, ys, zs)) == List.append(&2, Nat, List.append(&2, Nat, xs, ys), zs) : +List<Nat>}

def app_assoc(xs, ys, zs):
  match xs:
    case Nil{}:
      {==}
    case h <> t:
      %app_assoc(t, ys, zs) : {h <> List.append(&2, Nat, t, List.append(&2, Nat, ys, zs)) == h <> _ : +List<Nat>}
      {==}

# reverse.go(xs, acc) is reverse(xs) with acc glued on the end
law rev_go:
  for +xs: +List<Nat>
  for +acc: +List<Nat>
  {List.append(&2, Nat, List.reverse.go(&2, Nat, xs, Nil{}), acc) == List.reverse.go(&2, Nat, xs, acc) : +List<Nat>}

def rev_go(xs, acc):
  match xs:
    case Nil{}:
      {==}
    case h <> t:
      -rt = List.reverse.go(&2, Nat, t, Nil{})
      %rev_go(t, h <> acc) : {List.append(&2, Nat, List.reverse.go(&2, Nat, t, [h]), acc) == _ : +List<Nat>}
      %rev_go(t, [h]) : {List.append(&2, Nat, _, acc) == List.append(&2, Nat, rt, h <> acc) : +List<Nat>}
      %app_assoc(List.reverse.go(&2, Nat, t, Nil{}), [h], acc) : {_ == List.append(&2, Nat, rt, h <> acc) : +List<Nat>}
      {==}

law rev_append:
  for +xs: +List<Nat>
  for +ys: +List<Nat>
  {List.append(&2, Nat, List.reverse(&2, Nat, ys), List.reverse(&2, Nat, xs)) == List.reverse(&2, Nat, List.append(&2, Nat, xs, ys)) : +List<Nat>}

def rev_append(xs, ys):
  match xs:
    case Nil{}:
      app_nil(List.reverse(&2, Nat, ys))
    case h <> t:
      -rys = List.reverse(&2, Nat, ys)
      -rt = List.reverse(&2, Nat, t)
      -lhs = List.append(&2, Nat, rys, List.reverse.go(&2, Nat, t, [h]))
      %rev_go(List.append(&2, Nat, t, ys), [h]) : {lhs == _ : +List<Nat>}
      %rev_append(t, ys) : {lhs == List.append(&2, Nat, _, [h]) : +List<Nat>}
      %app_assoc(List.reverse(&2, Nat, ys), List.reverse(&2, Nat, t), [h]) : {lhs == _ : +List<Nat>}
      %rev_go(t, [h]) : {List.append(&2, Nat, rys, _) == List.append(&2, Nat, rys, List.append(&2, Nat, rt, [h])) : +List<Nat>}
      {==}

# ---- The laws from LAWS.bend ----

def Laws.size_mirror(t):
  match t:
    case T.Leaf{v}:
      {==}
    case T.Node{+l, +r}:
      %Laws.size_mirror(l) : {Nat.add(T.size(T.mirror(r)), T.size(T.mirror(l))) == Nat.add(_, T.size(r)) : Nat}
      %Laws.size_mirror(r) : {Nat.add(T.size(T.mirror(r)), T.size(T.mirror(l))) == Nat.add(T.size(T.mirror(l)), _) : Nat}
      add_comm(T.size(T.mirror(r)), T.size(T.mirror(l)))

def Laws.sum_mirror(t):
  match t:
    case T.Leaf{v}:
      {==}
    case T.Node{+l, +r}:
      %Laws.sum_mirror(l) : {Nat.add(T.sum(T.mirror(r)), T.sum(T.mirror(l))) == Nat.add(_, T.sum(r)) : Nat}
      %Laws.sum_mirror(r) : {Nat.add(T.sum(T.mirror(r)), T.sum(T.mirror(l))) == Nat.add(T.sum(T.mirror(l)), _) : Nat}
      add_comm(T.sum(T.mirror(r)), T.sum(T.mirror(l)))

def Laws.size_flatten(t):
  match t:
    case T.Leaf{v}:
      {==}
    case T.Node{+l, +r}:
      %Laws.size_flatten(l) : {List.length(&2, Nat, List.append(&2, Nat, T.flatten(l), T.flatten(r))) == Nat.add(_, T.size(r)) : Nat}
      %Laws.size_flatten(r) : {List.length(&2, Nat, List.append(&2, Nat, T.flatten(l), T.flatten(r))) == Nat.add(List.length(&2, Nat, T.flatten(l)), _) : Nat}
      length_append(T.flatten(l), T.flatten(r))

def Laws.sum_flatten(t):
  match t:
    case T.Leaf{v}:
      add_zero(v)
    case T.Node{+l, +r}:
      %Laws.sum_flatten(l) : {T.list_sum(List.append(&2, Nat, T.flatten(l), T.flatten(r))) == Nat.add(_, T.sum(r)) : Nat}
      %Laws.sum_flatten(r) : {T.list_sum(List.append(&2, Nat, T.flatten(l), T.flatten(r))) == Nat.add(T.list_sum(T.flatten(l)), _) : Nat}
      sum_append(T.flatten(l), T.flatten(r))

def Laws.flatten_mirror(t):
  match t:
    case T.Leaf{v}:
      {==}
    case T.Node{+l, +r}:
      -lhs = List.append(&2, Nat, T.flatten(T.mirror(r)), T.flatten(T.mirror(l)))
      %rev_append(T.flatten(l), T.flatten(r)) : {lhs == _ : +List<Nat>}
      %Laws.flatten_mirror(l) : {lhs == List.append(&2, Nat, List.reverse(&2, Nat, T.flatten(r)), _) : +List<Nat>}
      %Laws.flatten_mirror(r) : {lhs == List.append(&2, Nat, _, T.flatten(T.mirror(l))) : +List<Nat>}
      {==}
