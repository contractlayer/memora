from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn

app = FastAPI(title="AI Search RAGAS Eval")


class EvalSample(BaseModel):
    question: str
    answer: str
    contexts: list[str]
    ground_truth: str | None = None


class EvalRequest(BaseModel):
    samples: list[EvalSample]


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/eval")
def evaluate(req: EvalRequest) -> dict[str, object]:
    # Placeholder. Real RAGAS integration comes in Phase 4.
    return {
        "samples_received": len(req.samples),
        "metrics": {"faithfulness": None, "answer_relevance": None, "context_precision": None},
        "note": "RAGAS runner not yet implemented — stub only.",
    }


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=7860)
