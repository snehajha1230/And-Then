import { NextRequest, NextResponse } from "next/server"
import { getDataFromToken } from "@/helpers/getDataFromToken"
import { connectDB } from "@/db/dbconfig"
import Room from "@/models/room.model"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    const userId = getDataFromToken(request)
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { code } = await params
    const roomCode = code.toUpperCase()

    await connectDB()

    const room = await Room.findOne({ roomCode })

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 })
    }

    // Check if user is the host
    if (room.hostId.toString() === userId) {
      return NextResponse.json({ error: "Host cannot leave the room. Please end the room instead." }, { status: 400 })
    }

    // Check if user is a participant
    const isParticipant = room.participants.some(
      (p: any) => p.toString() === userId || (p._id && p._id.toString() === userId),
    )

    if (!isParticipant) {
      return NextResponse.json({ error: "You are not a participant in this room" }, { status: 403 })
    }

    // Remove user from participants
    room.participants = room.participants.filter(
      (p: any) => p.toString() !== userId && (p._id ? p._id.toString() !== userId : true),
    )

    // Remove user's votes from choiceVotes
    if (room.choiceVotes) {
      room.choiceVotes.forEach((userIds: any[], choiceId: string) => {
        const filtered = userIds.filter((id: any) => id.toString() !== userId)
        if (filtered.length === 0) {
          room.choiceVotes.delete(choiceId)
        } else {
          room.choiceVotes.set(choiceId, filtered)
        }
      })
    }

    // Remove user's votes from genreVotes
    if (room.genreVotes) {
      room.genreVotes.forEach((userIds: any[], genreId: string) => {
        const filtered = userIds.filter((id: any) => id.toString() !== userId)
        if (filtered.length === 0) {
          room.genreVotes.delete(genreId)
        } else {
          room.genreVotes.set(genreId, filtered)
        }
      })
    }

    await room.save()

    return NextResponse.json({
      message: "Left room successfully",
    })
  } catch (error) {
    console.error("Leave room error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

