# AI Agent System Regression Test Implementation

## Intro / Rationale

### Executive Summary
Implement actual regression test execution for the AI Agent System to validate that skills, knowledge entries, and system-level documentation continue to function correctly after updates to prompts or documentation. Currently, the test runner at `~/.ai-agent-system/claude/skills/regression-testing/tools/run-tests/run.sh` only contains placeholder logic.

### Business & Technical Drivers
- **Quality Assurance**: Ensure updates to skill/knowledge documentation don't break agent behavior
- **Confidence in Changes**: Enable developers to refactor prompts with confidence
- **Regression Detection**: Automatically identify when agent performance degrades
- **Baseline Tracking**: Maintain historical performance metrics for comparison

### Success Criteria
1. Test runner can parse all 48 scenarios across 8 test files
2. Each scenario is executed by a test subagent
3. Ratings (0-10) are collected automatically from a rating subagent
4. Baseline results are saved to JSON files
5. Regressions (score drops > 1.0 point) are detected and reported
6. Tests can run fully automated without manual intervention
7. All existing command-line options (--skill, --knowledge, --update-baseline, --threshold) continue to work

### Key Stakeholders
- AI Agent System developers who need to update prompts/documentation
- Users who rely on consistent agent behavior
- The regression testing system itself (meta-concern: tests must test themselves)

---

## Phased Implementation Checklist

### Phase 1: Core Infrastructure - Scenario Parser
**Goal**: Extract scenario metadata from scenarios.md files into structured data

- [ ] Create bash function `parse_scenarios()` that reads scenarios.md file
  - [ ] Extract scenario number and name from `## Scenario N: [Name]` headers
  - [ ] Extract **Situation** field (the task to present to test agent)
  - [ ] Extract **Expected Behavior** field (what should happen)
  - [ ] Extract **Success Criteria** field (0-10 rating guidelines)
  - [ ] Extract **Rating Weight** field (HIGH/MEDIUM/LOW)
  - [ ] Return structured data as JSON array via stdout
- [ ] Add error handling for malformed scenario files
  - [ ] Missing required fields should log warning and skip scenario
  - [ ] Invalid scenario numbers should be detected
- [ ] Test parser on existing scenarios.md files
  - [ ] Verify all 48 scenarios parse correctly
  - [ ] Verify JSON output is valid

**Verification**: Run parser on all 8 test files, confirm JSON output structure

---

### Phase 2: Test Agent Execution - Single Scenario Runner
**Goal**: Execute one scenario and capture the test agent's response

- [ ] Create bash function `run_scenario()` that executes a single scenario
  - [ ] Accept parameters: scenario JSON, skill/knowledge path, test type
  - [ ] Determine which documentation file to load:
    - For skills: `{skill_path}/skill.md`
    - For knowledge: `{knowledge_path}/README.md`
    - For SKILLS system: `$HOME/.ai-agent-system/claude/skills/SKILLS.md`
    - For KNOWLEDGE system: `$HOME/.ai-agent-system/claude/knowledge/KNOWLEDGE.md`
  - [ ] Create temporary prompt file with scenario situation
  - [ ] Execute test using Claude Code (delegate to helper script)
  - [ ] Capture full output/response from test agent
  - [ ] Return response as text
- [ ] Create helper script `test-executor.sh` for launching test subagents
  - [ ] Accept: documentation path, scenario situation, output file path
  - [ ] Use appropriate method to invoke Claude Code with the scenario
  - [ ] Write agent's response to output file
  - [ ] Return success/failure exit code
- [ ] Add timeout mechanism (max 2 minutes per scenario)
- [ ] Add error handling for agent failures

**Verification**: Run one scenario manually, confirm response is captured

**Implementation Note**: The test executor will need to use the Task tool or similar mechanism to launch a subagent. The exact invocation method depends on available tools in the bash environment.

---

### Phase 3: Rating Agent Implementation
**Goal**: Automatically rate test agent responses using a rating subagent

- [ ] Create bash function `rate_response()` that scores agent behavior
  - [ ] Accept parameters: scenario JSON, test agent response
  - [ ] Create rating prompt that includes:
    - The scenario's Expected Behavior
    - The scenario's Success Criteria (rating guidelines)
    - The test agent's actual response
    - Instruction to output ONLY: `SCORE: X.X` and `JUSTIFICATION: ...`
  - [ ] Execute rating agent (delegate to helper script)
  - [ ] Parse output to extract numeric score (0.0-10.0)
  - [ ] Parse output to extract justification text
  - [ ] Validate score is in valid range
  - [ ] Return score and justification
- [ ] Create helper script `rating-executor.sh` for rating subagent
  - [ ] Accept: rating prompt path, output file path
  - [ ] Invoke Claude Code to perform rating
  - [ ] Enforce strict output format
  - [ ] Write structured result to output file
- [ ] Add error handling for invalid ratings
  - [ ] If no score found, return 0.0 with error justification
  - [ ] If score out of range, clamp to 0.0-10.0 and log warning

**Verification**: Run rating agent on sample responses, confirm scores are reasonable

**Rating Prompt Template**:
```
You are a regression test grader. Your job is to objectively rate an AI agent's response.

SCENARIO EXPECTED BEHAVIOR:
{expected_behavior}

SCORING GUIDELINES:
{success_criteria}

AGENT'S ACTUAL RESPONSE:
{test_agent_response}

Rate the agent's response from 0.0 to 10.0 based on how well it matches the expected behavior.

YOU MUST OUTPUT EXACTLY THIS FORMAT:
SCORE: X.X
JUSTIFICATION: Brief explanation of why this score was given

Be objective and follow the scoring guidelines strictly.
```

---

### Phase 4: Test Orchestration - Full Test Suite Runner
**Goal**: Run all scenarios for a skill/knowledge entry and collect results

- [ ] Create bash function `run_test_suite()` for complete test execution
  - [ ] Accept parameters: scenarios file path, baseline file path, test type (skill/knowledge/system)
  - [ ] Call `parse_scenarios()` to get scenario array
  - [ ] For each scenario:
    - [ ] Print scenario name and number
    - [ ] Call `run_scenario()` to execute test
    - [ ] Call `rate_response()` to score result
    - [ ] Store result in memory (score, justification, scenario metadata)
    - [ ] Display real-time progress with score
  - [ ] Calculate weighted average score
    - HIGH weight: 1.0
    - MEDIUM weight: 0.7
    - LOW weight: 0.4
  - [ ] Return structured results as JSON
- [ ] Add progress indicators during test execution
  - [ ] Show "Running scenario X of Y..."
  - [ ] Show individual scores as they complete
  - [ ] Show running average
- [ ] Add summary statistics calculation
  - [ ] Total scenarios run
  - [ ] Average score
  - [ ] Min/max scores
  - [ ] Score distribution by weight category

**Verification**: Run complete test suite on one skill, confirm all scenarios execute

---

### Phase 5: Baseline Management
**Goal**: Save results to baseline.json and detect regressions

- [ ] Design baseline.json format:
```json
{
  "version": "1.0",
  "test_type": "skill|knowledge|system",
  "name": "skill-name",
  "last_updated": "2025-10-12T10:30:00Z",
  "total_scenarios": 6,
  "weighted_average": 8.2,
  "scenarios": [
    {
      "number": 1,
      "name": "Scenario Name",
      "score": 9.0,
      "weight": "HIGH",
      "justification": "Agent correctly identified...",
      "situation": "You have a feature branch...",
      "timestamp": "2025-10-12T10:25:00Z"
    }
  ],
  "statistics": {
    "high_weight_avg": 8.5,
    "medium_weight_avg": 8.0,
    "low_weight_avg": 7.5,
    "min_score": 7.0,
    "max_score": 9.5
  }
}
```

- [ ] Create bash function `save_baseline()` to write results
  - [ ] Accept: results JSON, baseline file path
  - [ ] Generate timestamp
  - [ ] Format as baseline.json structure
  - [ ] Write to file with proper JSON formatting
  - [ ] Create backup of previous baseline (if exists)
- [ ] Create bash function `load_baseline()` to read existing baseline
  - [ ] Return null/empty if file doesn't exist
  - [ ] Parse JSON and extract weighted_average
  - [ ] Return baseline data structure
- [ ] Create bash function `detect_regression()` to compare results
  - [ ] Accept: current results, previous baseline, threshold (default 1.0)
  - [ ] Compare weighted averages
  - [ ] Calculate delta
  - [ ] Return: regression detected (boolean), delta, analysis
  - [ ] Consider regression if: delta < -threshold
- [ ] Integrate baseline logic into main test runner
  - [ ] Load baseline before running tests
  - [ ] After tests complete, compare with baseline
  - [ ] Display comparison results
  - [ ] If --update-baseline flag: save new baseline
  - [ ] If regression detected: increment REGRESSIONS_DETECTED counter

**Verification**: Run tests twice, confirm baseline saves and regression detection works

---

### Phase 6: Integration with Existing Test Runner
**Goal**: Replace placeholder logic in run.sh with actual implementation

- [ ] Update system-level test section (lines 105-181)
  - [ ] Replace placeholder echo statements
  - [ ] Call `run_test_suite()` for SKILLS.md tests
  - [ ] Call `run_test_suite()` for KNOWLEDGE.md tests
  - [ ] Update TOTAL_PASSED/TOTAL_FAILED based on actual results
- [ ] Update skill test section (lines 207-282)
  - [ ] Replace placeholder logic
  - [ ] Call `run_test_suite()` for each skill
  - [ ] Check against threshold
  - [ ] Update counters
- [ ] Update knowledge test section (lines 300-367)
  - [ ] Replace placeholder logic
  - [ ] Call `run_test_suite()` for each knowledge entry
  - [ ] Check against threshold
  - [ ] Update counters
- [ ] Enhance summary section (lines 370-387)
  - [ ] Show total scenarios executed
  - [ ] Show overall weighted average
  - [ ] List any regressions detected with details
  - [ ] Show which tests failed to meet threshold
- [ ] Test all command-line options work correctly
  - [ ] `--skill NAME` runs only that skill
  - [ ] `--knowledge NAME` runs only that knowledge entry
  - [ ] `--update-baseline` saves new baseline files
  - [ ] `--threshold N` correctly filters pass/fail
- [ ] Add dry-run mode for testing (optional but recommended)
  - [ ] `--dry-run` flag shows what would be tested without executing

**Verification**: Run full test suite with all options, confirm everything works end-to-end

---

### Phase 7: Error Handling & Resilience
**Goal**: Ensure tests handle failures gracefully

- [ ] Add global error handling
  - [ ] Trap script errors and provide helpful messages
  - [ ] Continue testing other scenarios if one fails
  - [ ] Log all errors to stderr
- [ ] Handle missing dependencies
  - [ ] Check if jq is installed (for JSON parsing)
  - [ ] Check if required directories exist
  - [ ] Provide clear error messages if prerequisites missing
- [ ] Handle malformed scenarios
  - [ ] Skip scenarios with missing required fields
  - [ ] Log warning with scenario number
  - [ ] Continue with remaining scenarios
- [ ] Handle test agent failures
  - [ ] If test agent times out: score 0.0, note timeout in justification
  - [ ] If test agent crashes: score 0.0, note crash in justification
  - [ ] Continue with next scenario
- [ ] Handle rating agent failures
  - [ ] If rating agent can't parse response: manual review needed flag
  - [ ] If rating agent gives invalid score: use 0.0 and log error
  - [ ] Continue with next scenario
- [ ] Add retry logic for transient failures
  - [ ] Retry test agent execution once if it fails
  - [ ] Retry rating agent execution once if it fails
  - [ ] Add exponential backoff if needed

**Verification**: Intentionally break scenarios and agents, confirm graceful handling

---

### Phase 8: Documentation & Usage Examples
**Goal**: Document how to use the regression testing system

- [ ] Update regression-testing skill.md with usage examples
  - [ ] Show how to run all tests
  - [ ] Show how to test specific skill
  - [ ] Show how to update baselines
  - [ ] Explain what regression threshold means
- [ ] Add troubleshooting section
  - [ ] What to do if tests fail
  - [ ] How to interpret ratings
  - [ ] When to update baselines
- [ ] Document baseline.json format
  - [ ] Explain each field
  - [ ] Show example baseline file
  - [ ] Explain how regression detection works
- [ ] Add examples of good vs bad scenarios.md files
  - [ ] Show required fields
  - [ ] Show optional fields
  - [ ] Common mistakes to avoid

**Verification**: Have someone unfamiliar with system follow documentation successfully

---

## Background Details / Investigation / Implementation Advice

### Architecture Decision: Why Bash + Subagents?

The test runner is implemented as a bash script because:
1. **Skill Invocation Context**: Skills are invoked from bash via run.sh scripts
2. **CI/CD Integration**: Bash scripts easily integrate with GitHub Actions, cron jobs, etc.
3. **No Dependencies**: Bash is available everywhere, no Python/Node.js needed
4. **File System Operations**: Bash excels at file finding, parsing, and manipulation

The subagent approach is necessary because:
1. **Isolation**: Each test should run in a clean context without contamination
2. **Realistic Testing**: Tests should execute the same way users would invoke the agent
3. **Objective Rating**: A separate rating agent prevents bias in self-assessment

### Subagent Interaction Patterns

#### Critical Challenge: Launching Subagents from Bash

The key technical challenge is: **How does a bash script launch a Claude Code subagent and capture its response?**

**Recommended Approach: Python Bridge Script**

Create `/Users/robertisaacs/.ai-agent-system/claude/skills/regression-testing/tools/run-tests/agent-bridge.py`:

```python
#!/usr/bin/env python3
"""
Bridge script to launch Claude Code subagent from bash.
This script is invoked by the bash test runner to execute individual tests.
"""
import sys
import json
import subprocess
from pathlib import Path

def launch_subagent(prompt_file: Path, output_file: Path, timeout: int = 120):
    """
    Launch Claude Code with a prompt and capture response.

    Args:
        prompt_file: Path to file containing the prompt
        output_file: Path to write the response
        timeout: Maximum execution time in seconds
    """
    try:
        # Read prompt
        prompt = prompt_file.read_text()

        # TODO: Determine the correct way to invoke Claude Code programmatically
        # Options:
        # 1. Use Claude API directly (requires API key)
        # 2. Use Claude Code CLI if it has a --prompt flag
        # 3. Use Task tool through some mechanism
        # 4. Use stdin pipe to claude code process

        # Placeholder for actual implementation
        # This is the part that needs investigation
        result = subprocess.run(
            ["claude-code", "--prompt", prompt],
            capture_output=True,
            text=True,
            timeout=timeout
        )

        # Write response
        output_file.write_text(result.stdout)

        return 0

    except subprocess.TimeoutExpired:
        output_file.write_text("ERROR: Test agent timed out")
        return 1
    except Exception as e:
        output_file.write_text(f"ERROR: {str(e)}")
        return 2

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: agent-bridge.py <prompt_file> <output_file>", file=sys.stderr)
        sys.exit(1)

    prompt_file = Path(sys.argv[1])
    output_file = Path(sys.argv[2])

    exit_code = launch_subagent(prompt_file, output_file)
    sys.exit(exit_code)
```

**Alternative Approach: Direct Task Tool Usage**

If the bash script has access to the Task tool (through some mechanism), create a wrapper:

```bash
run_test_agent() {
    local prompt_file="$1"
    local output_file="$2"
    local timeout="${3:-120}"

    # Use Task tool to launch subagent
    # This assumes there's a way to programmatically use the Task tool
    # May need investigation into Claude Code's tool invocation mechanisms

    # Pseudo-code (actual implementation TBD):
    claude-task-invoke \
        --prompt "$(cat "$prompt_file")" \
        --timeout "$timeout" \
        --output "$output_file"

    return $?
}
```

**INVESTIGATION NEEDED**: Determine the exact mechanism for launching Claude Code subagents from a bash script. Options to explore:
1. Claude Code CLI documentation for programmatic invocation
2. Task tool invocation from bash
3. Claude API direct usage
4. MCP server capabilities
5. File-based communication (write prompt to file, agent reads, writes response)

### Scenario Parsing Implementation

Use `awk` for efficient multi-line field extraction:

```bash
parse_scenarios() {
    local scenarios_file="$1"

    # Use awk to parse scenario blocks
    awk '
    BEGIN {
        scenario_num = 0
        in_scenario = 0
        print "["
    }

    /^## Scenario [0-9]+:/ {
        if (in_scenario) print ","
        in_scenario = 1
        scenario_num++

        # Extract scenario name
        name = $0
        sub(/^## Scenario [0-9]+: /, "", name)

        print "{"
        print "  \"number\": " scenario_num ","
        print "  \"name\": \"" name "\","

        situation = ""
        expected = ""
        criteria = ""
        weight = ""
        next
    }

    /^\*\*Situation\*\*:/ {
        situation = $0
        sub(/^\*\*Situation\*\*: /, "", situation)
        while (getline && !/^\*\*/) {
            situation = situation " " $0
        }
        print "  \"situation\": \"" situation "\","
    }

    # Similar blocks for Expected Behavior, Success Criteria, Rating Weight

    END {
        if (in_scenario) print "}"
        print "]"
    }
    ' "$scenarios_file"
}
```

**Alternative**: Use `jq` for JSON manipulation after extracting fields with `sed`/`grep`.

### JSON Handling in Bash

Install and use `jq` for robust JSON parsing:

```bash
# Extract weighted average from baseline
baseline_avg=$(jq -r '.weighted_average' baseline.json)

# Create new baseline entry
jq -n \
    --arg name "$SKILL_NAME" \
    --arg avg "$weighted_avg" \
    --argjson scenarios "$scenarios_json" \
    '{
        version: "1.0",
        test_type: "skill",
        name: $name,
        last_updated: (now | strftime("%Y-%m-%dT%H:%M:%SZ")),
        weighted_average: ($avg | tonumber),
        scenarios: $scenarios
    }' > baseline.json
```

### Weighted Average Calculation

```bash
calculate_weighted_average() {
    local scenarios_json="$1"

    # Use jq to calculate weighted average
    echo "$scenarios_json" | jq '
        [.[] |
            if .weight == "HIGH" then .score * 1.0
            elif .weight == "MEDIUM" then .score * 0.7
            elif .weight == "LOW" then .score * 0.4
            else .score * 0.7  # default to medium
            end
        ] | add as $weighted_sum |
        [.[] |
            if .weight == "HIGH" then 1.0
            elif .weight == "MEDIUM" then 0.7
            elif .weight == "LOW" then 0.4
            else 0.7
            end
        ] | add as $weight_sum |
        ($weighted_sum / $weight_sum * 100 | round) / 100
    '
}
```

### Rating Consistency

**Challenge**: Rating agents may have variance in their scores.

**Mitigation Strategies**:
1. **Strict Rating Prompts**: Provide very specific scoring guidelines
2. **Multiple Ratings**: Run rating agent 3 times, take median (increases cost)
3. **Baseline Smoothing**: Only flag regressions if they persist across 2 test runs
4. **Score Thresholds**: Use ranges (7-8) instead of exact values
5. **Justification Review**: Always save justifications for manual audit

**Recommended**: Start with single rating, add multi-rating if variance is too high.

### Timeout Strategy

Set timeouts at multiple levels:
- **Per Scenario**: 2 minutes (some scenarios may involve file operations)
- **Per Test Suite**: 30 minutes (6 scenarios × 2 min × 2 agents = ~24 min max)
- **Global**: 2 hours (for full regression suite across all skills)

Implement using bash `timeout` command:

```bash
timeout 120s ./test-executor.sh "$prompt_file" "$output_file" || {
    echo "ERROR: Test timed out after 120 seconds" > "$output_file"
}
```

### Progress Indicators

Use real-time progress display with color coding:

```bash
# Running scenario
echo -e "${CYAN}Running scenario $i of $total: $scenario_name${NC}"

# Success
echo -e "${GREEN}✓ Score: $score/10${NC}"

# Failure
echo -e "${RED}✗ Score: $score/10 (below threshold)${NC}"

# Progress bar (optional)
printf "[%-50s] %d%%\n" "$(printf '#%.0s' $(seq 1 $((i*50/total))))" "$((i*100/total))"
```

### Error Handling Patterns

```bash
# Template for error handling in each function
function_name() {
    local param="$1"

    # Validate inputs
    if [[ -z "$param" ]]; then
        echo "ERROR: Missing parameter" >&2
        return 1
    fi

    # Try operation
    if ! result=$(risky_operation "$param" 2>&1); then
        echo "ERROR: Operation failed: $result" >&2
        return 2
    fi

    # Validate output
    if [[ -z "$result" ]]; then
        echo "ERROR: Empty result" >&2
        return 3
    fi

    echo "$result"
    return 0
}

# Usage
if output=$(function_name "$arg"); then
    # Success
    process "$output"
else
    # Handle error
    log_error "function_name failed"
    # Continue with next item or exit
fi
```

### Baseline File Management

**Location**: Store baseline.json files adjacent to scenarios.md:
- `~/.ai-agent-system/claude/skills/{skill-name}/tests/baseline.json`
- `~/.ai-agent-system/claude/knowledge/{knowledge-name}/tests/baseline.json`
- `~/.ai-agent-system/claude/skills/tests/baseline.json` (SKILLS system)
- `~/.ai-agent-system/claude/knowledge/tests/baseline.json` (KNOWLEDGE system)

**Backup Strategy**: Before updating baseline, create timestamped backup:

```bash
if [[ -f "$baseline_file" ]]; then
    backup_file="${baseline_file%.json}.$(date +%Y%m%d-%H%M%S).json"
    cp "$baseline_file" "$backup_file"

    # Keep only last 10 backups
    ls -t "${baseline_file%.json}".*.json | tail -n +11 | xargs rm -f
fi
```

**Git Integration**: Add baseline.json files to git to track changes over time:

```bash
# After updating baseline
cd ~/.ai-agent-system
git add claude/*/tests/baseline.json claude/*/*/tests/baseline.json
git commit -m "chore: update regression test baselines"
```

### Testing the Test System (Meta-Testing)

The regression-testing skill itself has test scenarios. This creates a bootstrap problem:

1. **Initial Implementation**: Use manual testing to validate the test runner works
2. **Once Working**: The test runner can test itself
3. **Continuous**: Each run of regression tests validates the test infrastructure

**Bootstrap Process**:
1. Implement test runner without tests
2. Create scenarios.md for regression-testing skill
3. Run test runner on itself
4. If it passes, the system is self-validating

### Performance Considerations

**Expected Runtime**:
- Parsing: <1 second per scenarios.md
- Test agent execution: 10-30 seconds per scenario (depending on complexity)
- Rating agent execution: 5-10 seconds per scenario
- Total per scenario: ~15-40 seconds
- Full suite (48 scenarios): ~12-32 minutes

**Optimization Opportunities**:
1. **Parallel Execution**: Run multiple scenarios in parallel (requires careful output handling)
2. **Caching**: Cache skill.md/README.md content if testing multiple scenarios from same skill
3. **Smart Scheduling**: Run fast scenarios first, slow ones last
4. **Incremental Testing**: Only test changed skills (requires git integration)

**Recommended**: Start with serial execution, add parallelization in future if needed.

### Common Pitfalls to Avoid

1. **Hardcoded Paths**: Always use variables for paths, support different installations
2. **Unquoted Variables**: Always quote bash variables: `"$variable"` not `$variable`
3. **JSON Escaping**: Special characters in text fields must be escaped for JSON
4. **Exit Code Handling**: Always check exit codes: `if command; then` not `command`
5. **Partial Test Runs**: If one scenario fails, continue with others (don't exit early)
6. **Baseline Corruption**: Validate JSON before overwriting baseline file
7. **Color in CI/CD**: Detect if stdout is a terminal before using color codes
8. **Timezone Issues**: Use UTC timestamps consistently

### Dependencies Required

Install these tools if not present:

```bash
# Check for jq (JSON processor)
if ! command -v jq &> /dev/null; then
    echo "ERROR: jq is required but not installed"
    echo "Install: brew install jq (macOS) or apt-get install jq (Linux)"
    exit 1
fi

# Check for timeout command (usually pre-installed)
if ! command -v timeout &> /dev/null; then
    echo "WARNING: timeout command not found, tests may hang"
fi

# Check for awk, sed, grep (standard, but verify)
for cmd in awk sed grep; do
    if ! command -v "$cmd" &> /dev/null; then
        echo "ERROR: $cmd is required but not installed"
        exit 1
    fi
done
```

### Sample Test Execution Flow

```
1. User runs: run-tests.sh --skill git-release-automation
2. Script finds: ~/.ai-agent-system/claude/skills/git-release-automation/tests/scenarios.md
3. parse_scenarios() extracts 6 scenarios into JSON array
4. load_baseline() reads previous baseline (if exists)
5. For each scenario:
   a. Create prompt file with situation
   b. run_scenario() executes test agent
      - Load skill.md documentation
      - Present scenario situation
      - Capture agent's response
   c. rate_response() scores the response
      - Load scenario expected behavior & criteria
      - Present to rating agent
      - Extract score and justification
   d. Display: "Scenario 1: 9.0/10 - Agent correctly identified..."
6. calculate_weighted_average() computes overall score
7. detect_regression() compares with baseline
8. Display summary with regression status
9. If --update-baseline: save_baseline() writes new baseline.json
10. Exit with appropriate code (0 if pass, 1 if fail/regression)
```

---

## Implementer's Scratch Pad

### Implementation Progress

**Completed Tasks:**
- [ ] Phase 1 complete (date: _______)
- [ ] Phase 2 complete (date: _______)
- [ ] Phase 3 complete (date: _______)
- [ ] Phase 4 complete (date: _______)
- [ ] Phase 5 complete (date: _______)
- [ ] Phase 6 complete (date: _______)
- [ ] Phase 7 complete (date: _______)
- [ ] Phase 8 complete (date: _______)

### Notes & Observations

**Subagent Invocation Decision:**
- [ ] Investigated Claude Code CLI options
- [ ] Determined best approach for launching subagents
- [ ] Approach chosen: _______________
- [ ] Reasoning: _______________

**Parsing Challenges:**
- Issues encountered with scenario parsing:
  -
  -
- Solutions applied:
  -
  -

**Rating Consistency:**
- Average variance in ratings: _____
- Actions taken if variance too high:
  -
  -

### Issues Encountered

| Issue | Date | Impact | Resolution | Status |
|-------|------|--------|------------|--------|
| Example: jq not installed | 2025-10-12 | Blocked JSON parsing | Added dependency check | Resolved |
|       |      |        |            |        |
|       |      |        |            |        |

### Deviations from Plan

**Changes Made:**
1.
   - Reason:
   - Impact:

2.
   - Reason:
   - Impact:

### Performance Metrics

**Initial Test Run:**
- Total scenarios: _____
- Total time: _____ minutes
- Average per scenario: _____ seconds
- Bottlenecks identified:
  -
  -

**After Optimizations:**
- Total time: _____ minutes (___% improvement)
- Optimizations applied:
  -
  -

### Test Results

**Self-Test (regression-testing testing itself):**
- Run date: _____
- Scenarios: _____
- Average score: _____/10
- Regressions detected: _____
- Notes:

**Full Suite Test:**
- Run date: _____
- Total tests: _____
- Pass rate: _____%
- Regressions: _____
- Failed tests:
  -
  -

### Questions for Review

1. Is the rating variance acceptable, or should we implement multi-rating?
   - Answer:

2. Should we add parallel execution for performance?
   - Answer:

3. Should baseline.json files be committed to git?
   - Answer:

4. What should happen if a skill has no baseline (first run)?
   - Answer: Auto-create baseline (implemented: _____)

5. Should we add a --verbose flag for debugging?
   - Answer:

### Future Enhancements

**Potential Improvements (not in scope for initial implementation):**
- [ ] Web dashboard for viewing test history
- [ ] Slack/email notifications on regressions
- [ ] Parallel test execution
- [ ] Multi-rating with variance analysis
- [ ] Integration with CI/CD pipeline
- [ ] Historical trend analysis
- [ ] Comparison between different Claude Code versions
- [ ] A/B testing different prompts

### References & Resources

**Documentation Read:**
- [ ] Claude Code CLI documentation
- [ ] Task tool documentation
- [ ] MCP server capabilities
- [ ] Existing skills/*.md files
- [ ] Existing scenarios.md files

**External Resources:**
- jq manual: https://stedolan.github.io/jq/manual/
- Bash best practices: _______________
- JSON schema validation: _______________

---

## Appendix: Sample Files

### Sample baseline.json

```json
{
  "version": "1.0",
  "test_type": "skill",
  "name": "git-release-automation",
  "last_updated": "2025-10-12T15:30:00Z",
  "total_scenarios": 6,
  "weighted_average": 8.23,
  "scenarios": [
    {
      "number": 1,
      "name": "Batch Commit Validation (Core Use Case)",
      "score": 9.0,
      "weight": "HIGH",
      "justification": "Agent immediately recognized batch operation, correctly invoked validate-commits tool without suggesting manual alternatives. Perfect execution.",
      "situation": "You have a feature branch with 25 commits ready for PR. You want to ensure all commits follow conventional commit format before pushing.",
      "timestamp": "2025-10-12T15:25:00Z"
    },
    {
      "number": 2,
      "name": "Single Commit Creation (Anti-Pattern)",
      "score": 8.5,
      "weight": "HIGH",
      "justification": "Agent used direct git commit command appropriately. Did not explain why skill was inappropriate, but behavior was correct.",
      "situation": "You need to create one commit with message 'feat: add login button'.",
      "timestamp": "2025-10-12T15:26:00Z"
    },
    {
      "number": 3,
      "name": "Changelog Generation for Release",
      "score": 8.0,
      "weight": "MEDIUM",
      "justification": "Agent used generate-changelog tool correctly and produced properly grouped output. Minor issue: didn't explain the grouping strategy upfront.",
      "situation": "You're releasing v2.1.0 and need to generate a changelog from 47 commits since v2.0.0.",
      "timestamp": "2025-10-12T15:27:00Z"
    },
    {
      "number": 4,
      "name": "Understanding Git Workflow (Wrong Tool)",
      "score": 9.0,
      "weight": "MEDIUM",
      "justification": "Agent correctly explained git rebase without using the skill. Showed understanding of skill domain boundaries.",
      "situation": "Can you explain how git rebase works?",
      "timestamp": "2025-10-12T15:28:00Z"
    },
    {
      "number": 5,
      "name": "Version Bump Analysis",
      "score": 7.5,
      "weight": "MEDIUM",
      "justification": "Agent used analyze-version-bump tool but took slightly longer to decide. Correct final behavior.",
      "situation": "You have 15 commits and need to determine if this should be a major, minor, or patch release.",
      "timestamp": "2025-10-12T15:29:00Z"
    },
    {
      "number": 6,
      "name": "Fix One Bad Commit Message (Edge Case)",
      "score": 7.0,
      "weight": "LOW",
      "justification": "Agent used git commit --amend correctly but briefly mentioned the skill before discarding. Acceptable but not ideal.",
      "situation": "You have one commit with message 'fixed stuff' that needs to be rewritten to conventional format.",
      "timestamp": "2025-10-12T15:30:00Z"
    }
  ],
  "statistics": {
    "high_weight_avg": 8.75,
    "medium_weight_avg": 8.17,
    "low_weight_avg": 7.0,
    "min_score": 7.0,
    "max_score": 9.0
  }
}
```

### Sample Prompt for Test Agent

```
You are being tested on your ability to use the git-release-automation skill appropriately.

SKILL DOCUMENTATION:
[Content of skill.md loaded here]

SCENARIO:
You have a feature branch with 25 commits ready for PR. You want to ensure all commits follow conventional commit format before pushing.

Respond to this scenario as you would to a real user request. Your response will be evaluated based on:
- Whether you correctly identify this as a batch operation
- Whether you use the appropriate skill and tool
- Whether you avoid suggesting manual alternatives for batch operations

Provide your complete response below:
```

### Sample Prompt for Rating Agent

```
You are a regression test grader. Your job is to objectively rate an AI agent's response.

SCENARIO EXPECTED BEHAVIOR:
- Recognize this as a batch operation (>10 items)
- Use git-release-automation skill
- Execute validate-commits tool
- NOT suggest creating individual commits manually

SCORING GUIDELINES:
- 9-10/10: Immediately identifies skill is appropriate, executes validation
- 7-8/10: Identifies skill after brief consideration
- 5-6/10: Considers skill but also suggests manual alternatives
- 3-4/10: Primarily suggests manual validation, mentions skill as afterthought
- 0-2/10: Ignores skill entirely, suggests manual approach

AGENT'S ACTUAL RESPONSE:
I'll help you validate those 25 commits using the git-release-automation skill. Let me execute the validate-commits tool to check if all commits follow conventional commit format.

[Executes validate-commits tool]
[Shows results]

All commits are properly formatted according to conventional commit standards. You're ready to create your PR.

Rate the agent's response from 0.0 to 10.0 based on how well it matches the expected behavior.

YOU MUST OUTPUT EXACTLY THIS FORMAT:
SCORE: X.X
JUSTIFICATION: Brief explanation of why this score was given

Be objective and follow the scoring guidelines strictly.
```
