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

    // If the user previously chose a hard exit, block re-joining
    const blocked = (room.blockedRejoinUsers || []).some(
      (id: any) => id.toString() === userId,
    )
    if (blocked) {
      return NextResponse.json(
        { error: "You chose to exit this room and cannot re-join." },
        { status: 403 },
      )
    }

    if (room.status === "completed") {
      return NextResponse.json({ error: "Room is no longer active" }, { status: 400 })
    }

    const hostIdString = room.hostId.toString()
    const userIsCurrentHost = hostIdString === userId

    // If the host slot is inactive (original host left with no participants)
    // Promote the first returning player to host
    // Note: Even if the previous host re-joins when hostActive is false, they will be promoted to host
    // This is an edge case (host left with no participants), and it makes sense to make them host again
    if (room.hostActive === false) {
      room.hostId = userId
      room.hostActive = true
      // Ensure the promoted host is not duplicated in participants
      room.participants = room.participants.filter(
        (p: any) => p.toString() !== userId && (p._id ? p._id.toString() !== userId : true),
      )
      await room.save()
    } else {
      // Host is active, handle normal join/re-join
      // Check if user is already in the room as a participant
      const isParticipant = room.participants.some(
        (p: any) => p.toString() === userId || (p._id && p._id.toString() === userId),
      )

      // If user is the current host trying to re-join, add them as a participant instead
      // This allows the host to re-join as a regular participant (host powers remain with current host)
      if (userIsCurrentHost && !isParticipant) {
        room.participants.push(userId)
        // Don't change hostId - keep the current host
        await room.save()
      } else if (!isParticipant && !userIsCurrentHost) {
        // Add user to participants (this includes previous hosts who want to rejoin)
        // Previous hosts will join as regular participants since they're not the current host
        // This ensures that even if a previous host tries to rejoin, they're treated as a normal participant
        room.participants.push(userId)
        await room.save()
      }
      // If user is already a participant, just return success (allows re-joining)
    }

    return NextResponse.json({
      message: "Joined room",
      room: {
        roomCode: room.roomCode,
        status: room.status,
        participants: room.participants,
        selectedGenre: room.selectedGenre,
        storyId: room.storyId,
        hostId: room.hostId,
        hostActive: room.hostActive,
      },
    })
  } catch (error) {
    console.error("Join room error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

