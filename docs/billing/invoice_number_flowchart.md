# Invoice Number Generation Flowchart

```mermaid
flowchart TD
    A[Start] --> B[Acquire Advisory Lock]
    B --> C[Get/Insert Number Settings]
    C --> D[Calculate Candidate Number]
    D --> E[Extract Existing Numbers]
    E --> F[Find Max, Existence, Next Taken]
    F --> G{Number Exists?}
    G -->|Yes| H[Jump to Max + 1]
    G -->|No| I{Smallest Taken Next?}
    I -->|Yes| J{Candidate < Next?}
    J -->|Yes| K[Use Candidate]
    J -->|No| H
    I -->|No| K
    K --> L[Format Number]
    H --> L
    L --> M[Release Lock]
    M --> N[Return Formatted Number]
```

## Key Steps Explanation

1. **Advisory Lock**: Ensures thread safety for number generation
2. **Number Settings**: Gets or creates the numbering configuration
3. **Candidate Calculation**: Determines next number from sequence
4. **Number Analysis**: Extracts and analyzes existing numbers
5. **Conflict Check**: Determines if candidate is safe to use
6. **Gap Detection**: Finds available gaps in number sequence
7. **Formatting**: Applies prefix and padding as needed
8. **Cleanup**: Releases lock and returns result