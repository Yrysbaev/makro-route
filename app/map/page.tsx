import { redirect } from "next/navigation";
import dynamic from "next/dynamic";
import { getCurrentSessionUser } from "@/lib/auth";

const MapClient = dynamic(() => import("./map-client"), { ssr: false });

export default async function MapPage() {
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect("/login");
  }
  return <MapClient />;
}
