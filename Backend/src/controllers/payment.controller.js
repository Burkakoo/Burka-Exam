import { Payment } from "../models/Payment.js";
import { Subscription } from "../models/Subscription.js";
import { User } from "../models/User.js";

export async function submitPayment(request, response) {
  try {
    const {
      amount,
      currency = "ETB",
      provider = "telebirr",
      transactionReference,
      transactionNumber,
      fullName,
      receiptUrl,
      receiptScreenshot,
      clientMutationId
    } = request.body;

    const ref = (transactionReference || transactionNumber || "").trim();
    const screenshot = (receiptUrl || receiptScreenshot || "").trim();
    const studentName = (fullName || request.user?.displayName || "").trim();
    const normalizedAmount = Number(amount) || 200;

    // Validation rule: At least (Transaction Number + Name + Amount) OR (Receipt Screenshot)
    const hasTxMethod = Boolean(ref && studentName && normalizedAmount > 0);
    const hasScreenshotMethod = Boolean(screenshot);

    if (!hasTxMethod && !hasScreenshotMethod) {
      return response.status(400).json({
        error: "At least one verification method is required: Transaction Number + Full Name + Amount OR a Receipt Screenshot."
      });
    }

    if (clientMutationId) {
      const existing = await Payment.findOne({
        userId: request.user._id,
        clientMutationId
      });
      if (existing) {
        return response.status(200).json({ payment: existing, replayed: true });
      }
    }

    const payment = await Payment.create({
      userId: request.user._id,
      fullName: studentName,
      amount: normalizedAmount,
      currency: String(currency).trim().toUpperCase() || "ETB",
      provider,
      transactionReference: ref || undefined,
      receiptUrl: screenshot || undefined,
      clientMutationId: clientMutationId || ("pm_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9)),
      status: "pending"
    });

    return response.status(201).json({
      message: "Your payment has been submitted for review.",
      payment
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to submit payment." });
  }
}

export async function listPayments(request, response) {
  try {
    const filter = {};
    if (request.user.role === "student") {
      filter.userId = request.user._id;
    }
    if (request.query.status && ["pending", "verified", "rejected", "refunded"].includes(request.query.status)) {
      filter.status = request.query.status;
    }

    const payments = await Payment.find(filter)
      .populate("userId", "displayName email phoneNumber")
      .sort({ submittedAt: -1 })
      .limit(200);
    return response.json({ payments });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to fetch payments." });
  }
}

export async function verifyPayment(request, response) {
  try {
    const { id } = request.params;
    const { status, reviewNote } = request.body;

    if (!["verified", "rejected", "refunded"].includes(status)) {
      return response.status(400).json({ error: "A valid verification status is required." });
    }

    const payment = await Payment.findById(id);
    if (!payment) {
      return response.status(404).json({ error: "Payment not found." });
    }

    if (payment.status === status) {
      const subscription = await Subscription.findOne({ paymentId: payment._id });
      return response.json({ payment, subscription });
    }

    const canRefundVerifiedPayment = payment.status === "verified" && status === "refunded";
    if (payment.status !== "pending" && !canRefundVerifiedPayment) {
      return response.status(409).json({
        error: `Payment has already been ${payment.status} and cannot be changed to ${status}.`
      });
    }

    const reviewedAt = new Date();
    const updatedPayment = await Payment.findOneAndUpdate(
      {
        _id: id,
        status: canRefundVerifiedPayment ? "verified" : "pending"
      },
      {
        $set: {
          status,
          reviewNote,
          reviewedBy: request.user._id,
          reviewedAt
        }
      },
      { new: true, runValidators: true }
    );

    if (!updatedPayment) {
      return response.status(409).json({ error: "Payment was reviewed by another request." });
    }

    let subscription;

    if (status === "verified") {
      // Lifetime subscription (100 years)
      const lifetimeEnd = new Date(reviewedAt.getTime() + 100 * 365 * 24 * 60 * 60 * 1000);
      subscription = await Subscription.findOneAndUpdate(
        { userId: payment.userId },
        {
          userId: payment.userId,
          plan: "lifetime",
          status: "active",
          amount: payment.amount,
          currency: payment.currency,
          startsAt: reviewedAt,
          endsAt: lifetimeEnd,
          paymentId: payment._id
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // Activate premium status directly on student user
      await User.findByIdAndUpdate(payment.userId, { isPremium: true });
    } else if (status === "refunded" || status === "rejected") {
      await Subscription.updateMany(
        { paymentId: payment._id, status: "active" },
        { $set: { status: "cancelled", endsAt: reviewedAt } }
      );

      // Check if user has any other active verified payments
      const hasOther = await Payment.exists({
        userId: payment.userId,
        _id: { $ne: payment._id },
        status: "verified"
      });
      if (!hasOther) {
        await User.findByIdAndUpdate(payment.userId, { isPremium: false });
      }
    }

    return response.json({ payment: updatedPayment, subscription });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to verify payment." });
  }
}

export async function cashDashboard(request, response) {
  try {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      pendingPayments,
      verifiedPayments,
      rejectedPayments,
      todayRevAgg,
      monthRevAgg,
      totalRevAgg
    ] = await Promise.all([
      Payment.countDocuments({ status: "pending" }),
      Payment.countDocuments({ status: "verified" }),
      Payment.countDocuments({ status: "rejected" }),
      Payment.aggregate([
        { $match: { status: "verified", reviewedAt: { $gte: startOfToday } } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]),
      Payment.aggregate([
        { $match: { status: "verified", reviewedAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ]),
      Payment.aggregate([
        { $match: { status: "verified" } },
        { $group: { _id: null, total: { $sum: "$amount" } } }
      ])
    ]);

    const todayRevenue = todayRevAgg[0]?.total || 0;
    const monthlyRevenue = monthRevAgg[0]?.total || 0;
    const totalRevenue = totalRevAgg[0]?.total || 0;

    return response.json({
      pendingPayments,
      verifiedPayments,
      approvedPayments: verifiedPayments,
      rejectedPayments,
      todayRevenue,
      monthlyRevenue,
      totalRevenue,
      totalVerifiedAmount: totalRevenue
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Failed to load dashboard." });
  }
}
