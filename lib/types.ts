export type Choice = { id: string; question_id: string; label: string; body: string; is_correct: boolean };
export type Question = {
  id: string; set_id: string; position: number; body: string;
  explanation: string | null; points: number; answer_choices?: Choice[];
};
export type QuestionSet = {
  id: string; title: string; instructions: string;
  scoring_mode: "equal" | "custom"; equal_points: number;
  default_reveal_mode: "immediate" | "after_close" | "hidden";
  status: "draft" | "ready"; created_at: string; updated_at: string;
};
export type Problem = { question_position: number; problem: string };
