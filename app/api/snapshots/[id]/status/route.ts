import { NextResponse } from "next/server";
import { getRunProgress } from "@/lib/runEngine";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const progress = await getRunProgress(id);
  return NextResponse.json(progress);
}
