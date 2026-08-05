import { redirect } from "next/navigation";

// The old public cat gallery is now the Johnny or Stevie game.
export default function CatsPage() {
  redirect("/johnny-or-stevie");
}
