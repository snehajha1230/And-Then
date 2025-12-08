import { NextRequest, NextResponse } from "next/server"
import { getDataFromToken } from "@/helpers/getDataFromToken"
import { connectDB } from "@/db/dbconfig"
import Room from "@/models/room.model"

export async function POST(request: NextRequest) {
  try {
    const userId = getDataFromToken(request)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { roomCode } = await request.json()

    if (!roomCode || typeof roomCode !== "string") {
      return NextResponse.json({ error: "Room code is required" }, { status: 400 })
    }

    await connectDB()

    const room = await Room.findOne({ roomCode: roomCode.toUpperCase() })

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }

    if (room.status === "completed") {
      return NextResponse.json({ error: "Room is no longer active" }, { status: 400 })
    }

    // Check if user is already in the room
    const isParticipant = room.participants.some(
      (p: any) => p.toString() === userId || (p._id && p._id.toString() === userId),
    )

    // Allow re-joining even if they were previously in the room (they may have left)
    if (!isParticipant) {
      // Add user to participants
      room.participants.push(userId)
      await room.save()
    }
    // If user is already a participant, just return success (allows re-joining)

    return NextResponse.json({
      message: "Joined room",
      room: {
        roomCode: room.roomCode,
        status: room.status,
        participants: room.participants,
        selectedGenre: room.selectedGenre,
        storyId: room.storyId,
      },
    })
  } catch (error) {
    console.error("Join room error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

