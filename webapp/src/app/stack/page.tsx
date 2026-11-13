import type { Metadata } from "next";
import StackSection from "@/components/sections/StackSection";

export const metadata: Metadata = { title: "Robot Stack" };

export default function Page() {
  return <StackSection />;
}
