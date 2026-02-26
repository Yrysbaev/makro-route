import { redirect } from "next/navigation";
import { getCurrentSessionUser } from "@/lib/auth";
import HistoryClient from "./history-client";

export default async function HistoryPage() {
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect("/login");
  }

  return <HistoryClient />;
}
