import { redirect } from "next/navigation";
import { getCurrentSessionUser } from "@/lib/auth";
import TripSummaryClient from "./summary-client";

type Params = {
  params: Promise<{ tripId: string }>;
};

export default async function TripSummaryPage({ params }: Params) {
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect("/login");
  }

  const { tripId } = await params;
  return <TripSummaryClient tripId={tripId} />;
}
