import { redirect } from "next/navigation";
import { getCurrentSessionUser } from "@/lib/auth";
import MapPageLoader from "./map-page-loader";

export default async function MapPage() {
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect("/login");
  }
  return <MapPageLoader />;
}
