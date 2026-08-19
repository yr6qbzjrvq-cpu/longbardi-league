// The playable quarterbacks. Each is a cut-out head; the body is drawn the
// same for everyone. The commissioner's head is shared with Hail Mary, the
// other three live in their own files to keep each one small enough to ship.
import { QB_HEAD_SRC } from "./hailMaryHead";
import { DT_HEAD_1_SRC } from "./dtHead1";
import { DT_HEAD_2_SRC } from "./dtHead2";
import { DT_HEAD_3_SRC } from "./dtHead3";

export const CHARACTERS = [
  { id: "qb1", src: QB_HEAD_SRC },
  { id: "qb2", src: DT_HEAD_1_SRC },
  { id: "qb3", src: DT_HEAD_2_SRC },
  { id: "qb4", src: DT_HEAD_3_SRC },
];
