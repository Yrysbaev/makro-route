import { redirect } from "next/navigation";
import { getCurrentSessionUser } from "@/lib/auth";
import TripClient from "./trip-client";

type Params = {
  params: Promise<{ tripId: string }>;
};

export default async function TripPage({ params }: Params) {
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect("/login");
  }

  const { tripId } = await params;
  return <TripClient tripId={tripId} />;
}
