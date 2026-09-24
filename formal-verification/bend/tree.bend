# tree.bend: a binary tree of Nat leaves, and parallel functions over it.
#
# Every recursive case uses a parallel let (`a b = f(l) f(r)`), so on a native
# build the two subtrees run on different cores. LAWS.bend states what these
# functions must satisfy; PROOF.bend proves it.

import Base

type Tree is Data:
  Leaf{value: Nat}
  Node{left: Tree, right: Tree}

# Number of leaves.
def size(t: Tree) -> Nat:
  match t:
    case Leaf{v}:
      1n
    case Node{l, r}:
      a b = size(l) size(r)
      Nat.add(a, b)

# Sum of the leaves, in parallel.
def sum(t: Tree) -> Nat:
  match t:
    case Leaf{v}:
      v
    case Node{l, r}:
      a b = sum(l) sum(r)
      Nat.add(a, b)

# Swap left and right at every node.
def mirror(t: Tree) -> Tree:
  match t:
    case Leaf{v}:
      Leaf{v}
    case Node{l, r}:
      a b = mirror(l) mirror(r)
      Node{b, a}

# The leaves, left to right, as a list.
def flatten(t: Tree) -> +List<Nat>:
  match t:
    case Leaf{v}:
      [v]
    case Node{l, r}:
      a b = flatten(l) flatten(r)
      List.append(&2, Nat, a, b)

# Sequential sum of a list: the reference that `sum` is checked against.
def list_sum(xs: +List<Nat>) -> Nat:
  match xs:
    case Nil{}:
      0n
    case h <> t:
      Nat.add(h, list_sum(t))
