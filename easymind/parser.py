from typing import Optional
import datetime
from pydantic import BaseModel, Field
import ollama

# 1. Define the desired output structure using Pydantic
class ReminderSchema(BaseModel):
    reminder_text: str = Field(
        description="The core action or event to remember, written clearly."
    )
    date: datetime.date = Field(
        description="The date of the reminder. If relative (e.g., 'tomorrow'), compute the actual calendar date."
    )
    time: Optional[datetime.time] = Field(
        default=None,
        description="The specific time of the reminder in HH:MM format, if mentioned."
    )
    location: Optional[str] = Field(
        default=None,
        description="The physical or virtual location of the event, if mentioned."
    )

# 2. Prepare your raw unstructured text input
input_text = "Don't forget to meet Sarah for coffee tomorrow at 3 PM at Starbucks."

# 3. Call Ollama with the structured format requirement
# Note: Structured outputs work best with models like llama3, llama3.1, or mistral
response = ollama.chat(
    model="qwen3.5:9b",
    messages=[
        {
            "role": "system",
            "content": "You are a helpful assistant that extracts reminder details from text. Today's date is Saturday, June 13, 2026."
        },
        {
            "role": "user",
            "content": f"You are a helpful assistant that extracts reminder details from text. Today's date is Saturday, June 13, 2026. Extract only the details from this reminder: {input_text}"
        }
    ],
    # Pass the Pydantic model directly to enforce JSON structure
    format=ReminderSchema.model_json_schema(),
    options={"temperature": 0} # Low temperature ensures strict compliance
)

# 4. Parse and display the structured response
structured_data = ReminderSchema.model_validate_json(response.message.content)

print(structured_data.model_dump_json(indent=2))
