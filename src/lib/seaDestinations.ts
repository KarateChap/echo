export interface Destination {
  name: string;
  type: "ewallet" | "bank";
  accountLabel: string;
}

export interface CountryConfig {
  code: string;
  name: string;
  currency: string;
  flag: string;
  destinations: Destination[];
}

const ewallet = (name: string, accountLabel = "Phone number"): Destination => ({
  name,
  type: "ewallet",
  accountLabel,
});

const bank = (name: string, accountLabel = "Account number"): Destination => ({
  name,
  type: "bank",
  accountLabel,
});

export const SEA_COUNTRIES: CountryConfig[] = [
  {
    code: "PH",
    name: "Philippines",
    currency: "PHP",
    flag: "\u{1F1F5}\u{1F1ED}",
    destinations: [
      ewallet("GCash"),
      ewallet("Maya"),
      ewallet("ShopeePay"),
      ewallet("Coins.ph"),
      ewallet("GrabPay"),
      bank("BDO Unibank"),
      bank("BPI"),
      bank("Metrobank"),
      bank("Landbank"),
      bank("PNB"),
      bank("UnionBank"),
    ],
  },
  {
    code: "ID",
    name: "Indonesia",
    currency: "IDR",
    flag: "\u{1F1EE}\u{1F1E9}",
    destinations: [
      ewallet("DANA"),
      ewallet("GoPay"),
      ewallet("ShopeePay"),
      ewallet("OVO"),
      ewallet("LinkAja"),
      bank("Bank Mandiri"),
      bank("BRI"),
      bank("BCA"),
      bank("BNI"),
    ],
  },
  {
    code: "VN",
    name: "Vietnam",
    currency: "VND",
    flag: "\u{1F1FB}\u{1F1F3}",
    destinations: [
      ewallet("MoMo"),
      ewallet("ZaloPay"),
      ewallet("ShopeePay"),
      ewallet("VNPay"),
      ewallet("Viettel Money"),
      bank("Vietcombank"),
      bank("VietinBank"),
      bank("BIDV"),
      bank("Techcombank"),
    ],
  },
  {
    code: "TH",
    name: "Thailand",
    currency: "THB",
    flag: "\u{1F1F9}\u{1F1ED}",
    destinations: [
      ewallet("TrueMoney"),
      ewallet("Rabbit LINE Pay"),
      ewallet("PromptPay", "PromptPay ID"),
      bank("Bangkok Bank"),
      bank("Kasikornbank"),
      bank("Krungthai Bank"),
      bank("SCB"),
    ],
  },
  {
    code: "MY",
    name: "Malaysia",
    currency: "MYR",
    flag: "\u{1F1F2}\u{1F1FE}",
    destinations: [
      ewallet("Touch 'n Go"),
      ewallet("GrabPay"),
      ewallet("Boost"),
      ewallet("ShopeePay"),
      ewallet("MAE by Maybank"),
      bank("Maybank"),
      bank("CIMB"),
      bank("Public Bank"),
      bank("RHB Bank"),
    ],
  },
  {
    code: "SG",
    name: "Singapore",
    currency: "SGD",
    flag: "\u{1F1F8}\u{1F1EC}",
    destinations: [
      ewallet("DBS PayLah!"),
      ewallet("GrabPay"),
      ewallet("PayNow", "PayNow ID"),
      bank("DBS"),
      bank("OCBC"),
      bank("UOB"),
    ],
  },
  {
    code: "MM",
    name: "Myanmar",
    currency: "MMK",
    flag: "\u{1F1F2}\u{1F1F2}",
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
    destinations: [
      ewallet("U-Money"),
      ewallet("M-Money"),
      bank("BCEL"),
      bank("Lao Development Bank"),
    ],
  },
  {
    code: "BN",
    name: "Brunei",
    currency: "BND",
    flag: "\u{1F1E7}\u{1F1F3}",
    destinations: [
      ewallet("Ding!"),
      bank("BIBD"),
      bank("Baiduri Bank"),
    ],
  },
  {
    code: "TL",
    name: "Timor-Leste",
    currency: "USD",
    flag: "\u{1F1F9}\u{1F1F1}",
    destinations: [
      ewallet("BNU Mobile"),
      bank("BNCTL"),
      bank("BNU"),
    ],
  },
];
