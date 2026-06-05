import { NextResponse as Response } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isAdmin } from "@/lib/permissions";
import { query } from "@/lib/db";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const statuses = await query("SELECT id, name FROM call_statuses ORDER BY id ASC");
    return Response.json({ statuses }, { status: 200 });
  } catch (error) {
    console.error("Error fetching statuses:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !isAdmin(session)) {
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { name } = await req.json();

    if (!name) {
      return Response.json({ message: "Name is required" }, { status: 400 });
    }

    const res = await query("INSERT INTO call_statuses (name) VALUES (?)", [name]);

    return Response.json({ message: "Status added successfully", id: res.insertId }, { status: 201 });
  } catch (error) {
    console.error("Error adding status:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
