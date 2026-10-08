import { recyclingCallRequest, endRecyclingCall } from "@/lib/server/recycling-call";
export const runtime = "nodejs";
export const POST = recyclingCallRequest;

export const DELETE = endRecyclingCall;
