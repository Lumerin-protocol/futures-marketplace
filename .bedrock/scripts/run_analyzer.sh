#!/bin/bash
# =============================================================================
# Market Maker Fee Analyzer Runner
# =============================================================================
#
# Analyzes Arbitrum transactions for market maker accounts to track:
# - wUSDC fees paid per transaction
# - Orders created/closed per transaction
# - Gas fees in ETH and USD
#
# Usage:
#   ./run_analyzer.sh                                    # Run with defaults (last 7 days)
#   ./run_analyzer.sh --start-date 2026-01-01           # Custom start date
#   ./run_analyzer.sh --start-date 2026-01-01 --end-date 2026-01-15  # Date range
#   ./run_analyzer.sh --tx 0x468ee2...                  # Single transaction
#   ./run_analyzer.sh -o my_report.csv                  # Custom output file
#   ./run_analyzer.sh -q                                # Quiet mode (summary only)
#   ./run_analyzer.sh -a                                # Analyze ALL wallets on contract
#   ./run_analyzer.sh --all --start-date 2026-01-01    # All wallets for date range
#   ./run_analyzer.sh -a -n                             # All wallets EXCEPT market maker
#   ./run_analyzer.sh -a -n -o others.csv              # Other traders only, save to file
#   ./run_analyzer.sh -H -o mm_total.csv               # Also output mm_total_hourly.csv
#   ./run_analyzer.sh --hourly --start-date 2026-01-01 # Hourly aggregated data (no gaps)
#
# First time setup:
#   1. cd .bedrock/scripts
#   2. cp .env.example .env
#   3. Edit .env with your API keys
#   4. python3 -m venv .venv
#   5. source .venv/bin/activate
#   6. pip install -r requirements-analyzer.txt
#
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if .env file exists
if [ ! -f "$SCRIPT_DIR/.env" ]; then
    echo "Error: .env file not found!"
    echo "Please copy .env.example to .env and fill in your API keys:"
    echo "  cp $SCRIPT_DIR/.env.example $SCRIPT_DIR/.env"
    exit 1
fi

# Check if virtual environment exists and activate it
if [ -d "$SCRIPT_DIR/.venv" ]; then
    source "$SCRIPT_DIR/.venv/bin/activate"
else
    echo "Warning: Virtual environment not found. Creating one..."
    python3 -m venv "$SCRIPT_DIR/.venv"
    source "$SCRIPT_DIR/.venv/bin/activate"
    pip install -r "$SCRIPT_DIR/requirements-analyzer.txt"
fi

# Run the analyzer (config loaded from .env by the script)
python3 "$SCRIPT_DIR/analyze_market_maker_fees.py" "$@"
