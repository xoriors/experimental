import Base
import ./tree.bend as T

def pow2(n: Nat) -> Nat:
  match n:
    case 0n:
      1n
    case 1n+p:
      Nat.double(pow2(p))

# A perfect tree of depth d whose leaves count 1n, 2n, 3n, ... left to right.
# `start` is the value of the leftmost leaf; the right half starts where the
# left half ends, so both halves are built by one parallel call.
def gen(+d: Nat, +start: Nat) -> T.Tree:
  match d:
    case 0n:
      T.Leaf{start}
    case 1n+p:
      l r = gen(p, start) gen(p, Nat.add(start, pow2(p)))
      T.Node{l, r}

# The tree depth: the first command-line argument, or 14 (16384 leaves).
def depth(args: List<String>) -> Nat:
  match args:
    case Nil{}:
      14n
    case a <> rest:
      Maybe.default(&2, Nat, Nat.read(a), 14n)

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    +d : Nat = depth(args)
    +t : T.Tree = gen(d, 1n)
    IO.print("depth         = " ++ Nat.show(d))
    IO.print("leaves        = " ++ Nat.show(T.size(t)))
    IO.print("sum           = " ++ Nat.show(T.sum(t)))
    IO.print("sum (flatten) = " ++ Nat.show(T.list_sum(T.flatten(t))))
    IO.print("sum (mirror)  = " ++ Nat.show(T.sum(T.mirror(t))))
