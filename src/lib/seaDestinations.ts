export interface Destination {
  name: string;
  type: "ewallet" | "bank";
  accountLabel: string;
  voiceKeywords?: string[];
}

export interface CountryConfig {
  code: string;
  name: string;
  currency: string;
  flag: string;
  destinations: Destination[];
  phoneMaxDigits: number;
  phonePrefix: string;
  bankMaxDigits: number;
}

const ewallet = (name: string, accountLabel = "Phone number", voiceKeywords?: string[]): Destination => ({
  name,
  type: "ewallet",
  accountLabel,
  ...(voiceKeywords && { voiceKeywords }),
});

const bank = (name: string, accountLabel = "Account number", voiceKeywords?: string[]): Destination => ({
  name,
  type: "bank",
  accountLabel,
  ...(voiceKeywords && { voiceKeywords }),
});

export const SEA_COUNTRIES: CountryConfig[] = [
  {
    code: "PH",
    name: "Philippines",
    currency: "PHP",
    flag: "\u{1F1F5}\u{1F1ED}",
    phoneMaxDigits: 11,
    phonePrefix: "09",
    bankMaxDigits: 12,
    destinations: [
      ewallet("GCash"),
      ewallet("Maya"),
      ewallet("ShopeePay"),
      ewallet("Coins.ph"),
      ewallet("GrabPay"),
      bank("BDO Unibank", undefined, ["bdo", "b.d.o.", "be do", "banco de oro"]),
      bank("BPI", undefined, ["bpi", "b.p.i.", "be pi", "bank of philippine islands"]),
      bank("Metrobank"),
      bank("Landbank"),
      bank("PNB", undefined, ["pnb", "p.n.b.", "philippine national bank"]),
      bank("UnionBank", undefined, ["union bank", "unionbank"]),
    ],
  },
  {
    code: "ID",
    name: "Indonesia",
    currency: "IDR",
    flag: "\u{1F1EE}\u{1F1E9}",
    phoneMaxDigits: 13,
    phonePrefix: "08",
    bankMaxDigits: 16,
    destinations: [
      ewallet("DANA", undefined, ["dana", "donna"]),
      ewallet("GoPay", undefined, ["gopay", "go pay"]),
      ewallet("ShopeePay"),
      ewallet("OVO", undefined, ["ovo", "o.v.o."]),
      ewallet("LinkAja", undefined, ["link aja", "linkaja"]),
      bank("Bank Mandiri", undefined, ["mandiri", "bank mandiri"]),
      bank("BRI", undefined, ["bri", "b.r.i.", "be ri", "bank rakyat"]),
      bank("BCA", undefined, ["bca", "b.c.a.", "be ca", "bank central asia"]),
      bank("BNI", undefined, ["bni", "b.n.i.", "be ni", "bank negara"]),
    ],
  },
  {
    code: "VN",
    name: "Vietnam",
    currency: "VND",
    flag: "\u{1F1FB}\u{1F1F3}",
    phoneMaxDigits: 10,
    phonePrefix: "0",
    bankMaxDigits: 14,
    destinations: [
      ewallet("MoMo"),
      ewallet("ZaloPay"),
      ewallet("ShopeePay"),
      ewallet("VNPay"),
      ewallet("Viettel Money"),
      bank("Vietcombank"),
      bank("VietinBank"),
      bank("BIDV", undefined, ["bidv", "b.i.d.v.", "be i de vi"]),
      bank("Techcombank", undefined, ["techcom", "techcombank"]),
    ],
  },
  {
    code: "TH",
    name: "Thailand",
    currency: "THB",
    flag: "\u{1F1F9}\u{1F1ED}",
    phoneMaxDigits: 10,
    phonePrefix: "0",
    bankMaxDigits: 12,
    destinations: [
      ewallet("TrueMoney"),
      ewallet("Rabbit LINE Pay"),
      ewallet("PromptPay", "PromptPay ID"),
      bank("Bangkok Bank"),
      bank("Kasikornbank"),
      bank("Krungthai Bank"),
      bank("SCB", undefined, ["scb", "s.c.b.", "siam commercial"]),
    ],
  },
  {
    code: "MY",
    name: "Malaysia",
    currency: "MYR",
    flag: "\u{1F1F2}\u{1F1FE}",
    phoneMaxDigits: 12,
    phonePrefix: "01",
    bankMaxDigits: 16,
    destinations: [
      ewallet("Touch 'n Go"),
      ewallet("GrabPay"),
      ewallet("Boost"),
      ewallet("ShopeePay"),
      ewallet("MAE by Maybank", undefined, ["mae", "may bank", "maybank"]),
      bank("Maybank"),
      bank("CIMB"),
      bank("Public Bank"),
      bank("RHB Bank", undefined, ["rhb", "r.h.b."]),
    ],
  },
  {
    code: "SG",
    name: "Singapore",
    currency: "SGD",
    flag: "\u{1F1F8}\u{1F1EC}",
    phoneMaxDigits: 8,
    phonePrefix: "",
    bankMaxDigits: 12,
    destinations: [
      ewallet("DBS PayLah!", undefined, ["paylah", "pay la", "dbs paylah"]),
      ewallet("GrabPay"),
      ewallet("PayNow", "PayNow ID", ["paynow", "pay now"]),
      bank("DBS", undefined, ["dbs", "d.b.s.", "the bs", "development bank"]),
      bank("OCBC", undefined, ["ocbc", "o.c.b.c.", "oversea chinese"]),
      bank("UOB", undefined, ["uob", "u.o.b.", "united overseas"]),
    ],
  },
  {
    code: "MM",
    name: "Myanmar",
    currency: "MMK",
    flag: "\u{1F1F2}\u{1F1F2}",
    phoneMaxDigits: 11,
    phonePrefix: "09",
    bankMaxDigits: 16,
    destinations: [
      ewallet("KBZPay"),
      ewallet("Wave Money"),
      bank("KBZ Bank"),
      bank("AYA Bank"),
      bank("CB Bank"),
    ],
  },
  {
    code: "KH",
    name: "Cambodia",
    currency: "KHR",
    flag: "\u{1F1F0}\u{1F1ED}",
    phoneMaxDigits: 10,
    phonePrefix: "0",
    bankMaxDigits: 16,
    destinations: [
      ewallet("ABA Pay"),
      ewallet("Wing Money"),
      ewallet("TrueMoney"),
      ewallet("Pi Pay"),
      bank("ACLEDA Bank"),
      bank("ABA Bank"),
      bank("Canadia Bank"),
    ],
  },
  {
    code: "LA",
    name: "Laos",
    currency: "LAK",
    flag: "\u{1F1F1}\u{1F1E6}",
    phoneMaxDigits: 10,
    phonePrefix: "020",
    bankMaxDigits: 16,
    destinations: [
      ewallet("U-Money"),
      ewallet("M-Money"),
      bank("BCEL", undefined, ["bcel", "b.c.e.l."]),
      bank("Lao Development Bank"),
    ],
  },
  {
    code: "BN",
    name: "Brunei",
    currency: "BND",
    flag: "\u{1F1E7}\u{1F1F3}",
    phoneMaxDigits: 7,
    phonePrefix: "",
    bankMaxDigits: 14,
    destinations: [
      ewallet("Ding!"),
      bank("BIBD", undefined, ["bibd", "b.i.b.d."]),
      bank("Baiduri Bank"),
    ],
  },
  {
    code: "TL",
    name: "Timor-Leste",
    currency: "USD",
    flag: "\u{1F1F9}\u{1F1F1}",
    phoneMaxDigits: 8,
    phonePrefix: "7",
    bankMaxDigits: 15,
    destinations: [
      ewallet("BNU Mobile", undefined, ["bnu mobile", "bnu"]),
      bank("BNCTL", undefined, ["bnctl", "b.n.c.t.l."]),
      bank("BNU", undefined, ["bnu", "b.n.u."]),
    ],
  },
];
