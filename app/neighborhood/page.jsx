import { notFound } from "next/navigation";
import NeighborhoodClient from "@/components/NeighborhoodClient";
import { canSeeNeighborhood } from "@/lib/neighborhoodAccess";
import { NEIGHBORHOOD_PUBLIC } from "@/lib/leagueData";

export const dynamic = "force-dynamic";

export const metadata = { title: "HSPNeighborhood" };

// Server side: only the access gate lives here. Which screen
// to show (creator vs. Town Square) depends on localStorage,
// so NeighborhoodClient decides after mount.
export default async function NeighborhoodPage() {
  if (!(await canSeeNeighborhood())) notFound();

  return <NeighborhoodClient preview={!NEIGHBORHOOD_PUBLIC} />;
}
