import type { Metadata } from "next";
import MapSection from "@/components/sections/MapSection";

export const metadata: Metadata = { title: "Map & Navigate" };

export default function Page() {
  return <MapSection />;
}
