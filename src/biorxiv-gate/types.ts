export const BIORXIV_GATE_VERDICTS = ["yes", "no", "not_sure"] as const;

export type BiorxivGateVerdict = (typeof BIORXIV_GATE_VERDICTS)[number];

export type BiorxivGateInput = {
  id: string;
  title: string;
  abstract: string;
};
