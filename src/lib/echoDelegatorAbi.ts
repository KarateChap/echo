export const echoDelegatorAbi = [
  {
    name: "delegate",
    type: "function",
    inputs: [
      { name: "agent", type: "address" },
      { name: "recipient", type: "address" },
      { name: "tokenAddress", type: "address" },
      { name: "maxPerCycle", type: "uint256" },
      { name: "cycleSeconds", type: "uint256" },
      { name: "expiresAt", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "executeTransfer",
    type: "function",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "tokenAddress", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "revoke",
    type: "function",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "tokenAddress", type: "address" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    name: "getPermission",
    type: "function",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "tokenAddress", type: "address" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "agent", type: "address" },
          { name: "maxPerCycle", type: "uint256" },
          { name: "cycleSeconds", type: "uint256" },
          { name: "expiresAt", type: "uint256" },
          { name: "cycleStart", type: "uint256" },
          { name: "spentThisCycle", type: "uint256" },
          { name: "active", type: "bool" },
        ],
      },
    ],
    stateMutability: "view",
  },
] as const;
