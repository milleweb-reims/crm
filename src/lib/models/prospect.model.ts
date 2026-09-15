import { Schema } from "mongoose";

import { registerModel } from "./register-model";

const addressSchema = new Schema(
  {
    full: { type: String, default: "" },
    line1: { type: String, default: "" },
    line2: { type: String, default: "" },
    city: { type: String, default: "" },
    // Clé normalisée (minuscules, sans accents) servant au rattachement
    // à un territoire. Dérivée de `city` via withCityKey aux points d'écriture.
    cityKey: { type: String, default: "" },
    postalCode: { type: String, default: "" },
    state: { type: String, default: "" },
    region: { type: String, default: "" },
    department: { type: String, default: "" },
    country: { type: String, default: "" },
    countryCode: { type: String, default: "" },
  },
  { _id: false }
);

const emailsSchema = new Schema(
  {
    individual: { type: String, default: "" },
    individualFirstName: { type: String, default: "" },
    individualLastName: { type: String, default: "" },
    contact: { type: String, default: "" },
    sales: { type: String, default: "" },
    marketing: { type: String, default: "" },
    finance: { type: String, default: "" },
    admin: { type: String, default: "" },
    all: { type: String, default: "" },
  },
  { _id: false }
);

const prospectSchema = new Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, default: "" },
    phoneInternational: { type: String, default: "" },
    phoneType: { type: String, default: "" },
    email: { type: String, default: "" },
    website: { type: String, default: "" },
    websiteRoot: { type: String, default: "" },
    address: { type: addressSchema, default: () => ({}) },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
    },
    reviews: {
      rating: { type: Number, default: 0 },
      count: { type: String, default: "0" },
    },
    isClosed: { type: Boolean, default: false },
    openingHours: { type: Schema.Types.Mixed, default: {} },
    socialLinks: {
      facebook: { type: String, default: "" },
      linkedin: { type: String, default: "" },
      twitter: { type: String, default: "" },
    },
    contactPages: { type: [String], default: [] },
    emails: { type: emailsSchema, default: () => ({}) },
    adPixels: { type: String, default: "" },
    status: {
      type: String,
      enum: [
        "prospect",
        "en_appel",
        "a_rappeler",
        "rdv",
        "lien_envoye",
        "paye",
        "pas_interesse",
      ],
      default: "prospect",
      required: true,
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    lockedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    lockedAt: { type: Date, default: null },
    // Prix de création du site, en euros HT, fixé par le closer qui détient la
    // fiche — jamais sous le plancher (voir pricing.ts). L'abonnement mensuel,
    // lui, reste un tarif du compte détenteur.
    quoteAmount: { type: Number, default: 1000 },
    devUrl: { type: String, default: null },
    deliveryStage: {
      type: String,
      enum: ["a_faire", "en_cours", "termine"],
      default: null,
    },
    rdvDate: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    paidAmount: { type: Number, default: null },
    // Figés à la réception du paiement, depuis le TTC réellement prélevé : la
    // part du closer ne doit pas bouger si le prix ou la règle change ensuite.
    paidAmountHt: { type: Number, default: null },
    closerCommission: { type: Number, default: null },
    gcPaymentId: { type: String, default: null },
    qontoInvoiceId: { type: String, default: null },
    qontoInvoiceNumber: { type: String, default: null },
    qontoInvoiceUrl: { type: String, default: null },
    gcBillingRequestId: { type: String, default: null },
    paymentLink: { type: String, default: null },
    paymentLinkCreatedAt: { type: Date, default: null },
    gcMandateBillingRequestId: { type: String, default: null },
    mandateLink: { type: String, default: null },
    mandateLinkCreatedAt: { type: Date, default: null },
    gcMandateId: { type: String, default: null },
    mandateSignedAt: { type: Date, default: null },
    gcSubscriptionId: { type: String, default: null },
    subscriptionStartDate: { type: Date, default: null },
    signedDate: { type: Date, default: null },
    deliveredDate: { type: Date, default: null },
    googleMapsLink: { type: String, default: "" },
    tags: { type: [String], default: [] },
    importBatch: { type: String, default: null },
  },
  { timestamps: true }
);

prospectSchema.index({ name: 1, "address.city": 1 });
prospectSchema.index({ status: 1 });
prospectSchema.index({ assignedTo: 1 });
prospectSchema.index({ "address.cityKey": 1 });
prospectSchema.index({ location: "2dsphere" });

export const Prospect =
  registerModel("Prospect", prospectSchema);
