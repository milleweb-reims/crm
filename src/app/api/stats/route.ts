import { NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { Prospect } from "@/lib/models/prospect.model";
import { Reminder } from "@/lib/models/reminder.model";
import { getAuthSession, unauthorized } from "@/lib/api-auth";

export async function GET() {
  const session = await getAuthSession();
  if (!session) return unauthorized();

  await connectDB();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

  const [
    statusCounts,
    totalProspects,
    thisMonthSignes,
    prevMonthSignes,
    monthlyTrend,
    todayReminders,
  ] = await Promise.all([
    // Count by status
    Prospect.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    // Total prospects
    Prospect.countDocuments(),
    // Signed this month
    Prospect.countDocuments({
      status: "signe",
      signedDate: { $gte: startOfMonth },
    }),
    // Signed prev month
    Prospect.countDocuments({
      status: "signe",
      signedDate: { $gte: startOfPrevMonth, $lte: endOfPrevMonth },
    }),
    // Monthly trend (last 6 months)
    Prospect.aggregate([
      {
        $match: {
          createdAt: {
            $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1),
          },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
    ]),
    // Today's reminders
    (() => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date();
      end.setHours(23, 59, 59, 999);

      const filter: Record<string, unknown> = {
        dueDate: { $gte: start, $lte: end },
        isCompleted: false,
      };

      if (session.user.role !== "admin") {
        filter.userId = session.user.id;
      }

      return Reminder.countDocuments(filter);
    })(),
  ]);

  const statusMap: Record<string, number> = {};
  for (const item of statusCounts) {
    statusMap[item._id] = item.count;
  }

  return NextResponse.json({
    totalProspects,
    byStatus: statusMap,
    rdv: statusMap.rdv || 0,
    enDev: statusMap.en_dev || 0,
    signesThisMonth: thisMonthSignes,
    signesPrevMonth: prevMonthSignes,
    monthlyTrend,
    todayReminders,
  });
}
