import { redirect } from "next/navigation";
import HomeClient from "./home-client";
import { getCurrentSessionUser } from "@/lib/auth";

export default async function Home() {
  const user = await getCurrentSessionUser();
  if (!user) {
    redirect("/login");
  }
  return <HomeClient />;
}
