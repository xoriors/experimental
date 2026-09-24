# LAWS.bend: the spec for tree.bend, written by a human.
#
# Each law is an open claim until PROOF.bend proves it with a def of the same
# name (`law sum_mirror` is proven by `def Laws.sum_mirror`). Agents must not
# edit this file to make a proof go through.

import Base
import ./tree.bend as T

# Mirroring twice gives back the tree you started with.
law mirror_involutive:
  for t: T.Tree
  {T.mirror(T.mirror(t)) == t : T.Tree}

# Mirroring neither adds nor loses leaves...
law size_mirror:
  for t: T.Tree
  {T.size(T.mirror(t)) == T.size(t) : Nat}

# ...nor changes the total.
law sum_mirror:
  for t: T.Tree
  {T.sum(T.mirror(t)) == T.sum(t) : Nat}

# Flattening keeps every leaf: one list element per leaf.
law size_flatten:
  for t: T.Tree
  {List.length(&2, Nat, T.flatten(t)) == T.size(t) : Nat}

# The parallel tree sum agrees with the plain sequential sum of the leaves.
law sum_flatten:
  for t: T.Tree
  {T.list_sum(T.flatten(t)) == T.sum(t) : Nat}

# What mirror actually does: it reverses the left-to-right order of leaves.
# The four laws above also hold for `mirror(t) = t`; this one does not, so it
# is the law that rules out a lazy (or buggy) implementation.
law flatten_mirror:
  for t: T.Tree
  {T.flatten(T.mirror(t)) == List.reverse(&2, Nat, T.flatten(t)) : +List<Nat>}
