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

    const designations = await query("SELECT id, name FROM designations ORDER BY name ASC");
    return Response.json({ designations }, { status: 200 });
  } catch (error) {
    console.error("Error fetching designations:", error);
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

    const res = await query("INSERT INTO designations (name) VALUES (?)", [name]);

    return Response.json({ message: "Designation added successfully", id: res.insertId }, { status: 201 });
  } catch (error) {
    console.error("Error adding designation:", error);
    return Response.json({ message: "Internal server error" }, { status: 500 });
  }
}
