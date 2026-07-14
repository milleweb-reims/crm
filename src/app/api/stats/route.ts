import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Reminder } from "@/lib/models/reminder.model";
import { Activity } from "@/lib/models/activity.model";
import { User } from "@/lib/models/user.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";
import mongoose from "mongoose";

function monthBounds() {
  const now = new Date();
  return {
    startOfMonth: new Date(now.getFullYear(), now.getMonth(), 1),
    startOfPrevMonth: new Date(now.getFullYear(), now.getMonth() - 1, 1),
    endOfPrevMonth: new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59),
    trendStart: new Date(now.getFullYear(), now.getMonth() - 5, 1),
    now,
  };
}

function todayBounds() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

async function countTodayReminders(userId: string, isAdmin: boolean) {
  const { start, end } = todayBounds();
  const filter: Record<string, unknown> = {
    dueDate: { $gte: start, $lte: end },
    isCompleted: false,
  };
  if (!isAdmin) filter.userId = userId;
  return Reminder.countDocuments(filter);
}

interface LeaderboardEntry {
  userId: string;
  name: string;
  sales: number;
  ca: number;
  rdv: number;
}

async function buildLeaderboard(startOfMonth: Date): Promise<LeaderboardEntry[]> {
  const [salesAgg, rdvAgg] = await Promise.all([
    Prospect.aggregate([
      { $match: { paidAt: { $gte: startOfMonth }, assignedTo: { $ne: null } } },
      {
        $group: {
          _id: "$assignedTo",
          sales: { $sum: 1 },
          ca: { $sum: { $ifNull: ["$paidAmount", 0] } },
        },
      },
    ]),
    Prospect.aggregate([
      { $match: { rdvDate: { $gte: startOfMonth }, assignedTo: { $ne: null } } },
      { $group: { _id: "$assignedTo", rdv: { $sum: 1 } } },
    ]),
  ]);

  const byUser = new Map<string, LeaderboardEntry>();
  for (const item of salesAgg) {
    byUser.set(String(item._id), {
      userId: String(item._id),
      name: "",
      sales: item.sales,
      ca: item.ca,
      rdv: 0,
    });
  }
  for (const item of rdvAgg) {
    const id = String(item._id);
    const entry = byUser.get(id) ?? {
      userId: id,
      name: "",
      sales: 0,
      ca: 0,
      rdv: 0,
    };
    entry.rdv = item.rdv;
    byUser.set(id, entry);
  }

  if (byUser.size === 0) return [];

  const users = await User.find({ _id: { $in: [...byUser.keys()] } })
    .select("name")
    .lean<{ _id: unknown; name: string }[]>();
  for (const user of users) {
    const entry = byUser.get(String(user._id));
    if (entry) entry.name = user.name;
  }

  return [...byUser.values()]
    .filter((entry) => entry.name)
    .sort((a, b) => b.sales - a.sales || b.rdv - a.rdv);
}

async function adminStats(userId: string) {
  const { startOfMonth, startOfPrevMonth, endOfPrevMonth, trendStart } =
    monthBounds();

  const [
    statusCounts,
    totalProspects,
    caAgg,
    caPrevAgg,
    monthlyTrend,
    leaderboard,
    todayReminders,
  ] = await Promise.all([
    Prospect.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Prospect.countDocuments(),
    Prospect.aggregate([
      { $match: { paidAt: { $gte: startOfMonth } } },
      {
        $group: {
          _id: null,
          ca: { $sum: { $ifNull: ["$paidAmount", 0] } },
          sales: { $sum: 1 },
        },
      },
    ]),
    Prospect.aggregate([
      { $match: { paidAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth } } },
      {
        $group: {
          _id: null,
          ca: { $sum: { $ifNull: ["$paidAmount", 0] } },
          sales: { $sum: 1 },
        },
      },
    ]),
    Prospect.aggregate([
      { $match: { createdAt: { $gte: trendStart } } },
      {
        $group: {
          _id: { year: { $year: "$createdAt" }, month: { $month: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]),
    buildLeaderboard(startOfMonth),
    countTodayReminders(userId, true),
  ]);

  const byStatus: Record<string, number> = {};
  for (const item of statusCounts) {
    byStatus[item._id] = item.count;
  }

  return {
    role: "admin" as const,
    totalProspects,
    byStatus,
    untreatedStock: byStatus.prospect || 0,
    caThisMonth: caAgg[0]?.ca ?? 0,
    caPrevMonth: caPrevAgg[0]?.ca ?? 0,
    salesThisMonth: caAgg[0]?.sales ?? 0,
    salesPrevMonth: caPrevAgg[0]?.sales ?? 0,
    leaderboard,
    monthlyTrend,
    todayReminders,
  };
}

async function closerStats(userId: string) {
  const { startOfMonth, startOfPrevMonth, endOfPrevMonth, now } = monthBounds();
  const { start: todayStart, end: todayEnd } = todayBounds();
  const me = new mongoose.Types.ObjectId(userId);

  const [
    myProspects,
    callsToday,
    upcomingRdv,
    liensEnvoyes,
    myCaAgg,
    salesPrevMonth,
    leaderboard,
    todayReminders,
  ] = await Promise.all([
    Prospect.countDocuments({ assignedTo: me }),
    Activity.countDocuments({
      userId: me,
      type: "call",
      createdAt: { $gte: todayStart, $lte: todayEnd },
    }),
    Prospect.countDocuments({ assignedTo: me, rdvDate: { $gte: now } }),
    Prospect.countDocuments({ assignedTo: me, status: "lien_envoye" }),
    Prospect.aggregate([
      { $match: { assignedTo: me, paidAt: { $gte: startOfMonth } } },
      {
        $group: {
          _id: null,
          ca: { $sum: { $ifNull: ["$paidAmount", 0] } },
          sales: { $sum: 1 },
        },
      },
    ]),
    Prospect.countDocuments({
      assignedTo: me,
      paidAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth },
    }),
    buildLeaderboard(startOfMonth),
    countTodayReminders(userId, false),
  ]);

  return {
    role: "closer" as const,
    myProspects,
    callsToday,
    upcomingRdv,
    liensEnvoyes,
    salesThisMonth: myCaAgg[0]?.sales ?? 0,
    salesPrevMonth,
    caThisMonth: myCaAgg[0]?.ca ?? 0,
    // Pas de CA global ni par closer pour les closers
    leaderboard: leaderboard.map(({ userId, name, sales }) => ({
      userId,
      name,
      sales,
    })),
    todayReminders,
  };
}

async function devStats() {
  const { startOfMonth } = monthBounds();
  const paidFilter = { paidAt: { $ne: null } };

  const [toDeliver, missingDevUrl, deliveredThisMonth, totalPaid, deliveryList] =
    await Promise.all([
      Prospect.countDocuments({ ...paidFilter, deliveredDate: null }),
      Prospect.countDocuments({
        ...paidFilter,
        $or: [{ devUrl: null }, { devUrl: "" }],
      }),
      Prospect.countDocuments({ deliveredDate: { $gte: startOfMonth } }),
      Prospect.countDocuments(paidFilter),
      Prospect.find({ ...paidFilter, deliveredDate: null })
        .select("name address.city paidAt devUrl")
        .sort({ paidAt: 1 })
        .limit(20)
        .lean(),
    ]);

  return {
    role: "dev" as const,
    toDeliver,
    missingDevUrl,
    deliveredThisMonth,
    totalPaid,
    deliveryList,
  };
}

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const { role, id } = session.user;

  if (role === "admin") {
    return NextResponse.json(await adminStats(id));
  }
  if (role === "dev") {
    return NextResponse.json(await devStats());
  }
  return NextResponse.json(await closerStats(id));
}
