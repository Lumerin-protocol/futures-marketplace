#!/usr/bin/env python3
"""
Market Maker Fee Analyzer

Analyzes Arbitrum transactions for market maker accounts to track:
- wUSDC fees paid per transaction
- wUSDC committed to orders
- Gas fees in ETH and USD

Usage:
    python analyze_market_maker_fees.py --start-date 2026-01-01 --end-date 2026-01-16

Requirements:
    pip install requests web3 python-dateutil python-dotenv
"""

import argparse
import csv
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import requests
from dotenv import load_dotenv
from web3 import Web3
from web3.exceptions import TransactionNotFound

# Load .env file from script directory
SCRIPT_DIR = Path(__file__).parent
ENV_FILE = SCRIPT_DIR / ".env"
if ENV_FILE.exists():
    load_dotenv(ENV_FILE)
else:
    # Try loading from current working directory as fallback
    load_dotenv()

# ============================================================================
# CONFIGURATION - Edit these or pass as environment variables
# ============================================================================

# Default configuration (can be overridden via CLI args or env vars)
DEFAULT_CONFIG = {
    "ARBISCAN_API_KEY": os.environ.get("ARBISCAN_API_KEY", ""),
    "ALCHEMY_URL": os.environ.get("ALCHEMY_URL", ""),
    "FUTURES_CONTRACT": os.environ.get("FUTURES_CONTRACT", "0x8464dc5ab80e76e497fad318fe6d444408e5ccda"),
    "MARKET_MAKER_WALLET": os.environ.get("MARKET_MAKER_WALLET", "0xc1e187E4a677Da017ecfAc011C9d381c3E7baeE4"),
}

# wUSDC decimals (standard USDC has 6 decimals)
USDC_DECIMALS = 6

# Event topic signatures (keccak256 hash of event signature)
# From Futures.sol contract
EVENT_TOPICS = {
    # Transfer(address indexed from, address indexed to, uint256 value)
    "Transfer": "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    # OrderCreated(bytes32 indexed orderId, address indexed participant, string destURL, uint256 pricePerDay, uint256 deliveryAt, bool isBuy)
    "OrderCreated": "0x1f52a6f4a2d2a66b497ba87509c3bf307f623f437d154026f26716ed2d496d3b",
    # OrderClosed(bytes32 indexed orderId, address indexed participant)
    "OrderClosed": "0xba23b3f42d60d00e8a99f8faa964276a8b5eb6b1088f9f2d1ea3482c95654fe6",
    # PositionCreated(bytes32 indexed positionId, address indexed seller, address indexed buyer, ...)
    "PositionCreated": "0x4258e60eecf21b127496b52cfc5b7b5299721db725ba5620a55e2a7c84d43294",
}

# Method IDs (first 4 bytes of keccak256 hash of function signature)
METHOD_IDS = {
    "multicall": "0xac9650d8",  # multicall(bytes[] data)
    "createOrder": "0x6828a054",  # createOrder(uint256,uint256,string,int8)
    "closeOrder": "0x3bed6b95",  # closeOrder(bytes32)
    "addMargin": "0xa43be948",  # addMargin(uint256) - DEPOSITS
    "removeMargin": "0xf11f854f",  # removeMargin(uint256) - WITHDRAWALS
}


# ============================================================================
# DATA CLASSES
# ============================================================================


@dataclass
class TransactionAnalysis:
    """Represents the analysis of a single transaction."""

    timestamp: datetime
    tx_hash: str
    wallet: str
    action: str
    method: str  # Raw method name (addMargin, multicall, etc.)
    usdc_fees: float  # wUSDC sent as order fees (Transfer events in multicall)
    usdc_deposit: float  # wUSDC deposited via addMargin
    usdc_withdrawal: float  # wUSDC withdrawn via removeMargin
    gas_fee_eth: float
    gas_fee_usd: float
    eth_price_usd: float
    orders_created: int
    orders_closed: int
    buy_orders: int
    sell_orders: int


# ============================================================================
# API CLIENTS
# ============================================================================


class ArbiscanClient:
    """Client for interacting with Arbiscan/Etherscan API (v2 API with chainid)."""

    # V2 API endpoint (Etherscan unified API)
    BASE_URL_V2 = "https://api.etherscan.io/v2/api"
    # Arbitrum One chain ID
    CHAIN_ID = 42161

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.session = requests.Session()

    def _request(self, params: dict) -> dict:
        """Make a request to Arbiscan API with rate limiting."""
        params["apikey"] = self.api_key
        params["chainid"] = self.CHAIN_ID  # Required for v2 API
        
        response = self.session.get(self.BASE_URL_V2, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()

        if data.get("status") == "0":
            msg = data.get("message", "Unknown error")
            result = data.get("result", "")
            # Some "0" status responses are actually valid (e.g., "No transactions found")
            if msg not in ["No transactions found", "No records found", "OK"]:
                print(f"  [Warning] API: {msg} - {str(result)[:100]}")

        # Rate limiting - free tier allows 5 calls/second
        time.sleep(0.25)
        return data

    def get_transactions(
        self,
        address: str,
        start_block: int = 0,
        end_block: int = 99999999,
        page: int = 1,
        offset: int = 1000,
    ) -> list:
        """Get list of normal transactions for an address (both from and to)."""
        params = {
            "module": "account",
            "action": "txlist",
            "address": address,
            "startblock": start_block,
            "endblock": end_block,
            "page": page,
            "offset": offset,
            "sort": "asc",
        }
        data = self._request(params)
        result = data.get("result", [])
        # Ensure result is a list of dicts, not an error string
        if isinstance(result, list):
            return result
        return []

    def get_transactions_to_contract(
        self,
        contract_address: str,
        start_block: int = 0,
        end_block: int = 99999999,
        page: int = 1,
        offset: int = 1000,
    ) -> list:
        """Get list of transactions TO a contract (all callers)."""
        # Note: This uses the same txlist endpoint but for the contract address
        # It returns all transactions where the contract is either sender or receiver
        params = {
            "module": "account",
            "action": "txlist",
            "address": contract_address,
            "startblock": start_block,
            "endblock": end_block,
            "page": page,
            "offset": offset,
            "sort": "asc",
        }
        data = self._request(params)
        result = data.get("result", [])
        if isinstance(result, list):
            # Filter to only include transactions TO the contract (not from it)
            return [tx for tx in result if tx.get("to", "").lower() == contract_address.lower()]
        return []

    def get_block_by_timestamp(self, timestamp: int, closest: str = "before") -> int:
        """Get block number closest to a timestamp."""
        params = {
            "module": "block",
            "action": "getblocknobytime",
            "timestamp": timestamp,
            "closest": closest,
        }
        data = self._request(params)
        result = data.get("result", 0)
        try:
            return int(result)
        except (ValueError, TypeError):
            return 0

    def get_eth_price(self) -> float:
        """Get current ETH price in USD."""
        params = {
            "module": "stats",
            "action": "ethprice",
        }
        data = self._request(params)
        result = data.get("result", {})
        if isinstance(result, dict):
            price = float(result.get("ethusd", 0))
            if price > 0:
                return price
        
        # Fallback: try CoinGecko API
        try:
            response = self.session.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params={"ids": "ethereum", "vs_currencies": "usd"},
                timeout=10,
            )
            if response.ok:
                data = response.json()
                return float(data.get("ethereum", {}).get("usd", 0))
        except Exception:
            pass
        
        # Final fallback: use approximate current price
        print("  [Warning] Could not fetch ETH price, using default $3300")
        return 3300.0


class AlchemyClient:
    """Client for interacting with Alchemy JSON-RPC API."""

    def __init__(self, url: str):
        self.url = url
        self.web3 = Web3(Web3.HTTPProvider(url))

    def get_transaction(self, tx_hash: str) -> dict:
        """Get transaction details."""
        try:
            tx = self.web3.eth.get_transaction(tx_hash)
            return dict(tx)
        except TransactionNotFound:
            return {}

    def get_transaction_receipt(self, tx_hash: str) -> dict:
        """Get transaction receipt with logs."""
        try:
            receipt = self.web3.eth.get_transaction_receipt(tx_hash)
            return dict(receipt)
        except TransactionNotFound:
            return {}

    def get_logs(
        self,
        address: str,
        from_block: int,
        to_block: int,
        topics: Optional[list] = None,
    ) -> list:
        """Get event logs."""
        filter_params = {
            "address": Web3.to_checksum_address(address),
            "fromBlock": from_block,
            "toBlock": to_block,
        }
        if topics:
            filter_params["topics"] = topics
        return self.web3.eth.get_logs(filter_params)

    def get_block_by_timestamp(self, timestamp: int, direction: str = "before") -> int:
        """
        Binary search for block number closest to timestamp.
        direction: 'before' returns block just before timestamp, 'after' returns block just after
        """
        latest_block = self.web3.eth.block_number
        
        # Binary search
        low = 1
        high = latest_block
        result_block = low if direction == "after" else high
        
        while low <= high:
            mid = (low + high) // 2
            block = self.web3.eth.get_block(mid)
            block_timestamp = int(block.timestamp)
            
            if block_timestamp == timestamp:
                return mid
            elif block_timestamp < timestamp:
                if direction == "after":
                    result_block = mid
                low = mid + 1
            else:
                if direction == "before":
                    result_block = mid
                high = mid - 1
        
        # Verify and adjust result
        result_block_data = self.web3.eth.get_block(result_block)
        result_timestamp = int(result_block_data.timestamp)
        
        if direction == "before" and result_timestamp > timestamp and result_block > 1:
            result_block -= 1
        elif direction == "after" and result_timestamp < timestamp and result_block < latest_block:
            result_block += 1
            
        return result_block

    def get_latest_block_number(self) -> int:
        """Get the latest block number."""
        return self.web3.eth.block_number


# ============================================================================
# TRANSACTION ANALYZER
# ============================================================================


class MarketMakerAnalyzer:
    """Analyzes market maker transactions on the futures contract."""

    def __init__(
        self,
        arbiscan_api_key: str,
        alchemy_url: str,
        futures_contract: str,
        market_maker_wallet: Optional[str] = None,
        analyze_all_wallets: bool = False,
        exclude_wallet: Optional[str] = None,
    ):
        self.arbiscan = ArbiscanClient(arbiscan_api_key)
        self.alchemy = AlchemyClient(alchemy_url)
        self.futures_contract = Web3.to_checksum_address(futures_contract)
        self.market_maker_wallet = Web3.to_checksum_address(market_maker_wallet) if market_maker_wallet else None
        self.analyze_all_wallets = analyze_all_wallets
        self.exclude_wallet = Web3.to_checksum_address(exclude_wallet) if exclude_wallet else None
        self.eth_price_cache: dict[int, float] = {}  # block -> price

    def get_eth_price_at_time(self, timestamp: int) -> float:
        """Get ETH price at a specific time (approximated with current price for now)."""
        if not self.eth_price_cache:
            self.eth_price_cache[0] = self.arbiscan.get_eth_price()
        return self.eth_price_cache[0]

    def decode_order_created_event(self, log: dict) -> dict:
        """
        Decode OrderCreated event log.
        
        Event signature: OrderCreated(bytes32 indexed orderId, address indexed participant, 
                                       string destURL, uint256 pricePerDay, uint256 deliveryAt, bool isBuy)
        
        Data layout (ABI encoded):
        - bytes 0-31: offset to destURL string (dynamic)
        - bytes 32-63: pricePerDay (uint256)
        - bytes 64-95: deliveryAt (uint256)
        - bytes 96-127: isBuy (bool, padded to 32 bytes)
        - bytes 128+: string data (length + content)
        """
        topics = log.get("topics", [])
        data = log.get("data", "0x")

        if len(topics) < 3:
            return {}

        # Topics[1] = orderId (bytes32, indexed)
        # Topics[2] = participant (address, indexed)
        order_id = topics[1] if len(topics) > 1 else None
        participant = "0x" + topics[2][-40:] if len(topics) > 2 else None

        # Decode data to get isBuy flag
        is_buy = False
        price_per_day = 0
        delivery_at = 0
        
        if data and data != "0x":
            try:
                data_hex = data[2:] if data.startswith("0x") else data
                data_bytes = bytes.fromhex(data_hex)
                
                # isBuy is at offset 96 (3rd uint256 slot after string offset)
                if len(data_bytes) >= 128:  # Need at least 4 slots (32 bytes each)
                    # Slot 0 (bytes 0-31): string offset
                    # Slot 1 (bytes 32-63): pricePerDay
                    price_per_day = int.from_bytes(data_bytes[32:64], "big")
                    # Slot 2 (bytes 64-95): deliveryAt
                    delivery_at = int.from_bytes(data_bytes[64:96], "big")
                    # Slot 3 (bytes 96-127): isBuy (bool)
                    is_buy = int.from_bytes(data_bytes[96:128], "big") == 1
            except Exception as e:
                pass  # Keep defaults

        return {
            "order_id": order_id,
            "participant": participant,
            "is_buy": is_buy,
            "price_per_day": price_per_day,
            "delivery_at": delivery_at,
        }

    def analyze_transaction(self, tx: dict, override_wallet: Optional[str] = None) -> Optional[TransactionAnalysis]:
        """Analyze a single transaction."""
        tx_hash = tx.get("hash", "")
        to_address = tx.get("to", "").lower()

        # Only analyze transactions to the futures contract
        if to_address != self.futures_contract.lower():
            return None

        # Skip failed transactions
        if tx.get("isError") == "1" or tx.get("txreceipt_status") == "0":
            return None

        timestamp = datetime.fromtimestamp(int(tx.get("timeStamp", 0)), tz=timezone.utc)
        # Use override wallet if provided, otherwise get from transaction
        wallet = override_wallet if override_wallet else tx.get("from", "")
        wallet_checksum = Web3.to_checksum_address(wallet) if wallet else ""

        # Get method ID
        input_data = tx.get("input", "")
        if hasattr(input_data, "hex"):
            input_data = "0x" + input_data.hex()
        if not input_data.startswith("0x"):
            input_data = "0x" + input_data
        method_id = input_data[:10] if len(input_data) >= 10 else ""

        # Determine method from method ID
        method = "unknown"
        for name, mid in METHOD_IDS.items():
            if method_id.lower() == mid.lower():
                method = name
                break

        # Get transaction receipt for detailed logs
        receipt = self.alchemy.get_transaction_receipt(tx_hash)
        logs = receipt.get("logs", [])

        # Analyze logs
        usdc_fees = 0.0
        usdc_deposit = 0.0
        usdc_withdrawal = 0.0
        orders_created = 0
        orders_closed = 0
        buy_orders = 0
        sell_orders = 0
        
        # Track all transfer amounts for analysis
        transfers_to_contract = []
        transfers_from_contract = []

        for log in logs:
            # Get topics - handle both dict and AttributeDict formats
            if hasattr(log, "topics"):
                topics = [t.hex() if hasattr(t, "hex") else t for t in log.topics]
            else:
                topics = log.get("topics", [])
                topics = [t.hex() if hasattr(t, "hex") else t for t in topics]

            if not topics:
                continue

            topic0 = topics[0] if topics else ""
            if hasattr(topic0, "hex"):
                topic0 = topic0.hex()
            if not topic0.startswith("0x"):
                topic0 = "0x" + topic0

            # Get log address
            log_address = log.address if hasattr(log, "address") else log.get("address", "")
            if hasattr(log_address, "lower"):
                log_address = log_address.lower()

            # Check for Transfer events
            if topic0.lower() == EVENT_TOPICS["Transfer"].lower():
                if len(topics) >= 3:
                    from_addr = "0x" + topics[1][-40:] if topics[1] else ""
                    to_addr = "0x" + topics[2][-40:] if topics[2] else ""

                    # Decode value from data
                    log_data = log.data if hasattr(log, "data") else log.get("data", "0x")
                    if hasattr(log_data, "hex"):
                        log_data = log_data.hex()
                    if log_data.startswith("0x"):
                        log_data = log_data[2:]
                    try:
                        value = int(log_data, 16) if log_data else 0
                        value_usdc = value / (10**USDC_DECIMALS)
                        
                        # Track transfers TO contract (from the transaction's wallet)
                        if (from_addr.lower() == wallet_checksum.lower()
                            and to_addr.lower() == self.futures_contract.lower()):
                            transfers_to_contract.append(value_usdc)
                        
                        # Track transfers FROM contract (to the transaction's wallet)
                        if (from_addr.lower() == self.futures_contract.lower()
                            and to_addr.lower() == wallet_checksum.lower()):
                            transfers_from_contract.append(value_usdc)
                    except ValueError:
                        pass

            # Check for OrderCreated events
            elif topic0.lower() == EVENT_TOPICS["OrderCreated"].lower():
                orders_created += 1
                # Decode to check if buy or sell
                log_data = log.data if hasattr(log, "data") else log.get("data", "0x")
                if hasattr(log_data, "hex"):
                    log_data = "0x" + log_data.hex()
                decoded = self.decode_order_created_event({"topics": topics, "data": log_data})
                if decoded.get("is_buy"):
                    buy_orders += 1
                else:
                    sell_orders += 1

            # Check for OrderClosed events
            elif topic0.lower() == EVENT_TOPICS["OrderClosed"].lower():
                orders_closed += 1

        # Categorize transfers based on method type
        if method == "addMargin":
            # All transfers to contract are deposits
            usdc_deposit = sum(transfers_to_contract)
            usdc_fees = 0.0
        elif method == "removeMargin":
            # All transfers from contract are withdrawals
            usdc_withdrawal = sum(transfers_from_contract)
            usdc_fees = 0.0
        elif method == "multicall":
            # In multicall, transfers to contract are order fees
            usdc_fees = sum(transfers_to_contract)
        else:
            # Unknown method - categorize as fees for safety
            usdc_fees = sum(transfers_to_contract)

        # Calculate gas fees
        gas_used = int(tx.get("gasUsed", 0))
        gas_price = int(tx.get("gasPrice", 0))
        gas_fee_wei = gas_used * gas_price
        gas_fee_eth = gas_fee_wei / 10**18

        # Get ETH price for USD conversion
        eth_price_usd = self.get_eth_price_at_time(int(tx.get("timeStamp", 0)))
        gas_fee_usd = gas_fee_eth * eth_price_usd

        # Determine action description (method is now a separate column, so no prefix needed)
        action = ""
        if method == "multicall":
            if orders_created > 0 and orders_closed > 0:
                action = f"{orders_created} created ({buy_orders}B/{sell_orders}S), {orders_closed} closed"
            elif orders_created > 0:
                action = f"{orders_created} orders ({buy_orders} buy, {sell_orders} sell)"
            elif orders_closed > 0:
                action = f"{orders_closed} orders closed"
            else:
                action = "other"
        elif method == "createOrder":
            action = f"{'buy' if buy_orders > 0 else 'sell'}"
        elif method == "addMargin":
            action = f"+${usdc_deposit:.2f} deposit"
        elif method == "removeMargin":
            action = f"-${usdc_withdrawal:.2f} withdrawal"

        return TransactionAnalysis(
            timestamp=timestamp,
            tx_hash=tx_hash,
            wallet=wallet,
            action=action,
            method=method,
            usdc_fees=usdc_fees,
            usdc_deposit=usdc_deposit,
            usdc_withdrawal=usdc_withdrawal,
            gas_fee_eth=gas_fee_eth,
            gas_fee_usd=gas_fee_usd,
            eth_price_usd=eth_price_usd,
            orders_created=orders_created,
            orders_closed=orders_closed,
            buy_orders=buy_orders,
            sell_orders=sell_orders,
        )

    def analyze_date_range(
        self,
        start_date: datetime,
        end_date: datetime,
        verbose: bool = True,
    ) -> list[TransactionAnalysis]:
        """Analyze all transactions in a date range."""
        results = []

        # Get block numbers for date range
        start_timestamp = int(start_date.timestamp())
        end_timestamp = int(end_date.timestamp())

        if verbose:
            print(f"Fetching block numbers for date range...")
            print(f"  Start: {start_date.isoformat()} (timestamp: {start_timestamp})")
            print(f"  End: {end_date.isoformat()} (timestamp: {end_timestamp})")

        start_block = self.arbiscan.get_block_by_timestamp(start_timestamp, "after")
        if start_block == 0:
            # Fallback to Alchemy
            if verbose:
                print("  Using Alchemy for block lookup (Arbiscan API unavailable)...")
            start_block = self.alchemy.get_block_by_timestamp(start_timestamp, "after")
        
        end_block = self.arbiscan.get_block_by_timestamp(end_timestamp, "before")
        if end_block == 0:
            end_block = self.alchemy.get_block_by_timestamp(end_timestamp, "before")

        if verbose:
            print(f"  Block range: {start_block} - {end_block}")

        # Fetch transactions based on mode
        all_txs = []
        page = 1
        
        # Use max offset (10000) for better pagination - Arbiscan can return less than requested
        MAX_OFFSET = 10000
        
        if self.analyze_all_wallets:
            # Fetch ALL transactions to the contract
            if verbose:
                print(f"\nFetching ALL transactions to contract {self.futures_contract}...")
            
            while True:
                txs = self.arbiscan.get_transactions_to_contract(
                    self.futures_contract,
                    start_block=start_block,
                    end_block=end_block,
                    page=page,
                    offset=MAX_OFFSET,
                )
                if not txs:
                    break
                all_txs.extend(txs)
                if len(txs) < MAX_OFFSET:
                    break
                page += 1
            
            futures_txs = all_txs  # Already filtered to contract
        else:
            # Fetch transactions from specific wallet
            if verbose:
                print(f"\nFetching transactions for wallet {self.market_maker_wallet}...")
            
            while True:
                txs = self.arbiscan.get_transactions(
                    self.market_maker_wallet,
                    start_block=start_block,
                    end_block=end_block,
                    page=page,
                    offset=MAX_OFFSET,
                )
                if not txs:
                    break
                all_txs.extend(txs)
                if len(txs) < MAX_OFFSET:
                    break
                page += 1

            # Filter for transactions to the futures contract
            futures_txs = [
                tx for tx in all_txs if tx.get("to", "").lower() == self.futures_contract.lower()
            ]

        # Filter out excluded wallet if specified
        if self.exclude_wallet:
            before_count = len(futures_txs)
            futures_txs = [
                tx for tx in futures_txs 
                if tx.get("from", "").lower() != self.exclude_wallet.lower()
            ]
            if verbose:
                excluded_count = before_count - len(futures_txs)
                print(f"  Excluded {excluded_count} transactions from {self.exclude_wallet[:10]}...")

        if verbose:
            print(f"  Found {len(all_txs)} total transactions")
            print(f"  {len(futures_txs)} transactions to futures contract")
            if self.analyze_all_wallets:
                unique_wallets = len(set(tx.get("from", "").lower() for tx in futures_txs))
                print(f"  {unique_wallets} unique wallets")
            print(f"\nAnalyzing transactions...")

        # Analyze each transaction
        for i, tx in enumerate(futures_txs):
            if verbose:
                print(f"  [{i+1}/{len(futures_txs)}] {tx.get('hash', '')[:16]}...", end=" ")

            analysis = self.analyze_transaction(tx)
            if analysis:
                results.append(analysis)
                if verbose:
                    print(f"✓ {analysis.method}: {analysis.action} | ${analysis.usdc_fees:.2f} fees")
            else:
                if verbose:
                    print("✗ skipped (failed or non-relevant)")

        return results


# ============================================================================
# OUTPUT FUNCTIONS
# ============================================================================


def write_csv(results: list[TransactionAnalysis], output_file: str):
    """Write results to CSV file."""
    with open(output_file, "w", newline="") as f:
        writer = csv.writer(f)

        # Header - optimized for pivot tables
        writer.writerow(
            [
                "Date",
                "Hour",
                "Minute",
                "Transaction ID",
                "Wallet",
                "Method",
                "Action Summary",
                "wUSDC Deposit ($)",
                "wUSDC Withdrawal ($)",
                "wUSDC Fees ($)",
                "Gas Fee (ETH)",
                "Gas Fee (USD)",
                "ETH Price (USD)",
                "Orders Created",
                "Buy Orders",
                "Sell Orders",
                "Orders Closed",
            ]
        )

        # Data rows
        for r in results:
            writer.writerow(
                [
                    r.timestamp.strftime("%Y-%m-%d"),  # Date only
                    r.timestamp.strftime("%H"),  # Hour (24h format)
                    r.timestamp.strftime("%M"),  # Minute
                    r.tx_hash,
                    r.wallet,
                    r.method,  # Filterable method name
                    r.action,  # Free text summary
                    f"{r.usdc_deposit:.6f}",
                    f"{r.usdc_withdrawal:.6f}",
                    f"{r.usdc_fees:.6f}",
                    f"{r.gas_fee_eth:.10f}",
                    f"{r.gas_fee_usd:.4f}",
                    f"{r.eth_price_usd:.2f}",
                    r.orders_created,
                    r.buy_orders,
                    r.sell_orders,
                    r.orders_closed,
                ]
            )


def write_hourly_csv(results: list[TransactionAnalysis], output_file: str, start_date: datetime, end_date: datetime):
    """Write hourly aggregated results to CSV file.
    
    Creates a row for every hour in the date range, even if no transactions occurred.
    This ensures no gaps in time-series data for graphing.
    """
    # Build hourly buckets for the entire date range
    hourly_data = {}
    
    # Initialize all hours in range with zeros
    current_hour = start_date.replace(minute=0, second=0, microsecond=0)
    end_hour = end_date.replace(minute=0, second=0, microsecond=0)
    
    while current_hour <= end_hour:
        hour_key = current_hour.strftime("%Y-%m-%d %H:00")
        hourly_data[hour_key] = {
            "datetime": current_hour,
            "transactions": 0,
            "unique_wallets": set(),
            "usdc_deposits": 0.0,
            "usdc_withdrawals": 0.0,
            "usdc_fees": 0.0,
            "gas_eth": 0.0,
            "gas_usd": 0.0,
            "orders_created": 0,
            "buy_orders": 0,
            "sell_orders": 0,
            "orders_closed": 0,
            "multicalls": 0,
            "add_margins": 0,
            "remove_margins": 0,
            "create_orders": 0,
        }
        current_hour += timedelta(hours=1)
    
    # Aggregate results into hourly buckets
    for r in results:
        hour_key = r.timestamp.strftime("%Y-%m-%d %H:00")
        if hour_key in hourly_data:
            bucket = hourly_data[hour_key]
            bucket["transactions"] += 1
            bucket["unique_wallets"].add(r.wallet)
            bucket["usdc_deposits"] += r.usdc_deposit
            bucket["usdc_withdrawals"] += r.usdc_withdrawal
            bucket["usdc_fees"] += r.usdc_fees
            bucket["gas_eth"] += r.gas_fee_eth
            bucket["gas_usd"] += r.gas_fee_usd
            bucket["orders_created"] += r.orders_created
            bucket["buy_orders"] += r.buy_orders
            bucket["sell_orders"] += r.sell_orders
            bucket["orders_closed"] += r.orders_closed
            # Count by method type
            if r.method == "multicall":
                bucket["multicalls"] += 1
            elif r.method == "addMargin":
                bucket["add_margins"] += 1
            elif r.method == "removeMargin":
                bucket["remove_margins"] += 1
            elif r.method == "createOrder":
                bucket["create_orders"] += 1
    
    # Write to CSV
    with open(output_file, "w", newline="") as f:
        writer = csv.writer(f)
        
        # Header
        writer.writerow([
            "Date",
            "Hour",
            "Transactions",
            "Unique Wallets",
            "wUSDC Deposits ($)",
            "wUSDC Withdrawals ($)",
            "wUSDC Fees ($)",
            "Gas Fee (ETH)",
            "Gas Fee (USD)",
            "Orders Created",
            "Buy Orders",
            "Sell Orders",
            "Orders Closed",
            "Multicalls",
            "AddMargins",
            "RemoveMargins",
            "CreateOrders",
        ])
        
        # Data rows - sorted by datetime
        for hour_key in sorted(hourly_data.keys()):
            bucket = hourly_data[hour_key]
            dt = bucket["datetime"]
            writer.writerow([
                dt.strftime("%Y-%m-%d"),
                dt.strftime("%H"),
                bucket["transactions"],
                len(bucket["unique_wallets"]),
                f"{bucket['usdc_deposits']:.2f}",
                f"{bucket['usdc_withdrawals']:.2f}",
                f"{bucket['usdc_fees']:.2f}",
                f"{bucket['gas_eth']:.6f}",
                f"{bucket['gas_usd']:.2f}",
                bucket["orders_created"],
                bucket["buy_orders"],
                bucket["sell_orders"],
                bucket["orders_closed"],
                bucket["multicalls"],
                bucket["add_margins"],
                bucket["remove_margins"],
                bucket["create_orders"],
            ])


def print_summary(results: list[TransactionAnalysis], show_wallet_breakdown: bool = False, wallet_address: Optional[str] = None):
    """Print summary statistics."""
    if not results:
        print("\nNo transactions found in the specified date range.")
        return

    # Calculate totals
    total_usdc_fees = sum(r.usdc_fees for r in results)
    total_usdc_deposits = sum(r.usdc_deposit for r in results)
    total_usdc_withdrawals = sum(r.usdc_withdrawal for r in results)
    net_account_change = total_usdc_deposits - total_usdc_withdrawals
    total_gas_eth = sum(r.gas_fee_eth for r in results)
    total_gas_usd = sum(r.gas_fee_usd for r in results)
    total_orders_created = sum(r.orders_created for r in results)
    total_orders_closed = sum(r.orders_closed for r in results)
    total_buy_orders = sum(r.buy_orders for r in results)
    total_sell_orders = sum(r.sell_orders for r in results)
    total_trading_cost = total_usdc_fees + total_gas_usd
    
    # Count by method type
    method_counts = {}
    method_gas = {}
    for r in results:
        method_counts[r.method] = method_counts.get(r.method, 0) + 1
        method_gas[r.method] = method_gas.get(r.method, 0.0) + r.gas_fee_usd
    
    # Filter for multicall transactions only (for per-tx averages)
    multicall_results = [r for r in results if r.method == "multicall"]
    multicall_count = len(multicall_results)
    multicall_fees = sum(r.usdc_fees for r in multicall_results) if multicall_count > 0 else 0
    multicall_gas = sum(r.gas_fee_usd for r in multicall_results) if multicall_count > 0 else 0
    avg_cost_per_trade = (multicall_fees + multicall_gas) / multicall_count if multicall_count > 0 else 0
    
    # Wallet breakdown (for --all mode)
    wallet_stats = {}
    for r in results:
        wallet = r.wallet
        if wallet not in wallet_stats:
            wallet_stats[wallet] = {"txs": 0, "gas": 0.0, "orders": 0, "deposits": 0.0}
        wallet_stats[wallet]["txs"] += 1
        wallet_stats[wallet]["gas"] += r.gas_fee_usd
        wallet_stats[wallet]["orders"] += r.orders_created
        wallet_stats[wallet]["deposits"] += r.usdc_deposit

    print("\n" + "=" * 70)
    if show_wallet_breakdown:
        unique_wallets = len(wallet_stats)
        print(f"SUMMARY ({unique_wallets} wallets)")
    elif wallet_address:
        print(f"SUMMARY: {wallet_address}")
    else:
        print("SUMMARY")
    print("=" * 70)
    
    if show_wallet_breakdown:
        # ORDER FOR ALL WALLETS MODE:
        # 1. Top Wallets by txn
        # 2. Account Activity
        # 3. Trading Activity
        # 4. Transactions by Type
        # 5. Costs
        # 6. Per Trade Averages
        
        # 1. Top Wallets
        if len(wallet_stats) > 1:
            print(f"\n🏆 TOP WALLETS BY TRANSACTIONS:")
            print("-" * 70)
            sorted_wallets = sorted(wallet_stats.items(), key=lambda x: -x[1]["txs"])[:10]
            for wallet, stats in sorted_wallets:
                print(f"  {wallet[:10]}...{wallet[-6:]}  {stats['txs']:5d} txs  {stats['orders']:6d} orders  ${stats['gas']:,.2f} gas")
        
        # 2. Account Activity
        print(f"\n💰 ACCOUNT ACTIVITY: ${net_account_change:,.2f} net")
        print("-" * 70)
        print(f"  Deposits (addMargin):       ${total_usdc_deposits:>12,.2f}")
        print(f"  Withdrawals (removeMargin): ${total_usdc_withdrawals:>12,.2f}")
        
        # 3. Trading Activity
        print(f"\n📈 TRADING ACTIVITY: {total_orders_created:,d} created | {total_orders_closed:,d} closed")
        print("-" * 70)
        print(f"  Buy Orders:    {total_buy_orders:,d}")
        print(f"  Sell Orders:   {total_sell_orders:,d}")
        
        # 4. Transactions by Type
        print(f"\n📊 TRANSACTIONS BY TYPE: {len(results)} txs | ${total_gas_usd:,.2f} gas")
        print("-" * 70)
        for method, count in sorted(method_counts.items(), key=lambda x: -x[1]):
            gas = method_gas.get(method, 0)
            print(f"  {method:20s}  {count:6d} txs    ${gas:,.2f} gas")
        
        # 5. Costs
        print(f"\n💸 COSTS: ${total_trading_cost:,.2f} total")
        print("-" * 70)
        print(f"  Order Fees (wUSDC):  ${total_usdc_fees:>12,.2f}")
        print(f"  Gas Fees (ETH):      {total_gas_eth:>12.6f} ETH")
        print(f"  Gas Fees (USD):      ${total_gas_usd:>12,.2f}")
        
        # 6. Per Trade Averages
        if multicall_count > 0:
            print(f"\n📉 PER-TRADE AVERAGES (multicall): ${avg_cost_per_trade:,.4f}/trade")
            print("-" * 70)
            print(f"  Avg Order Fees:   ${multicall_fees/multicall_count:,.4f}")
            print(f"  Avg Gas:          ${multicall_gas/multicall_count:,.4f}")
    
    else:
        # ORDER FOR SINGLE WALLET MODE:
        # 1. Account Activity
        # 2. Trading Activity
        # 3. Transactions by Type
        # 4. Costs
        # 5. Per Trade Averages
        
        # 1. Account Activity
        print(f"\n💰 ACCOUNT ACTIVITY: ${net_account_change:,.2f} net")
        print("-" * 70)
        print(f"  Deposits (addMargin):       ${total_usdc_deposits:>12,.2f}")
        print(f"  Withdrawals (removeMargin): ${total_usdc_withdrawals:>12,.2f}")
        
        # 2. Trading Activity
        print(f"\n📈 TRADING ACTIVITY: {total_orders_created:,d} created | {total_orders_closed:,d} closed")
        print("-" * 70)
        print(f"  Buy Orders:    {total_buy_orders:,d}")
        print(f"  Sell Orders:   {total_sell_orders:,d}")
        
        # 3. Transactions by Type
        print(f"\n📊 TRANSACTIONS BY TYPE: {len(results)} txs | ${total_gas_usd:,.2f} gas")
        print("-" * 70)
        for method, count in sorted(method_counts.items(), key=lambda x: -x[1]):
            gas = method_gas.get(method, 0)
            print(f"  {method:20s}  {count:6d} txs    ${gas:,.2f} gas")
        
        # 4. Costs
        print(f"\n💸 COSTS: ${total_trading_cost:,.2f} total")
        print("-" * 70)
        print(f"  Order Fees (wUSDC):  ${total_usdc_fees:>12,.2f}")
        print(f"  Gas Fees (ETH):      {total_gas_eth:>12.6f} ETH")
        print(f"  Gas Fees (USD):      ${total_gas_usd:>12,.2f}")
        
        # 5. Per Trade Averages
        if multicall_count > 0:
            print(f"\n📉 PER-TRADE AVERAGES (multicall): ${avg_cost_per_trade:,.4f}/trade")
            print("-" * 70)
            print(f"  Avg Order Fees:   ${multicall_fees/multicall_count:,.4f}")
            print(f"  Avg Gas:          ${multicall_gas/multicall_count:,.4f}")
    
    print("=" * 70)


# ============================================================================
# MAIN
# ============================================================================


def main():
    parser = argparse.ArgumentParser(
        description="Analyze market maker fees on futures contract",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Analyze last 7 days
  python analyze_market_maker_fees.py --start-date 2026-01-09 --end-date 2026-01-16

  # Analyze specific transaction
  python analyze_market_maker_fees.py --tx 0x468ee2cb8644517607602f24e7bd647a3a0491c46843f5f271469d69f97ce268

  # Use environment variables for API keys
  export ARBISCAN_API_KEY="your_key"
  export ALCHEMY_URL="https://arb-mainnet.g.alchemy.com/v2/your_key"
  python analyze_market_maker_fees.py --start-date 2026-01-01

Environment Variables:
  ARBISCAN_API_KEY      Arbiscan/Etherscan API key
  ALCHEMY_URL           Alchemy node URL for Arbitrum
  FUTURES_CONTRACT      Futures contract address
  MARKET_MAKER_WALLET   Market maker wallet address
        """,
    )

    parser.add_argument(
        "--arbiscan-api-key",
        default=DEFAULT_CONFIG["ARBISCAN_API_KEY"],
        help="Arbiscan API key",
    )
    parser.add_argument(
        "--alchemy-url",
        default=DEFAULT_CONFIG["ALCHEMY_URL"],
        help="Alchemy node URL",
    )
    parser.add_argument(
        "--futures-contract",
        default=DEFAULT_CONFIG["FUTURES_CONTRACT"],
        help="Futures contract address",
    )
    parser.add_argument(
        "--market-maker-wallet",
        default=DEFAULT_CONFIG["MARKET_MAKER_WALLET"],
        help="Market maker wallet address",
    )
    parser.add_argument(
        "--all",
        "-a",
        action="store_true",
        help="Analyze ALL wallets interacting with the contract (not just a specific wallet)",
    )
    parser.add_argument(
        "--nomm",
        "-n",
        action="store_true",
        help="Exclude the market maker wallet (from .env) - use with --all to see other traders only",
    )
    parser.add_argument(
        "--hourly",
        "-H",
        action="store_true",
        help="Generate additional hourly summary CSV (e.g., output_hourly.csv) with aggregated data per hour",
    )
    parser.add_argument(
        "--start-date",
        type=str,
        help="Start date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--end-date",
        type=str,
        default=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        help="End date (YYYY-MM-DD), defaults to today",
    )
    parser.add_argument(
        "--tx",
        type=str,
        help="Analyze a single transaction by hash",
    )
    parser.add_argument(
        "--output",
        "-o",
        type=str,
        default="market_maker_fees.csv",
        help="Output CSV file path",
    )
    parser.add_argument(
        "--quiet",
        "-q",
        action="store_true",
        help="Suppress verbose output",
    )

    args = parser.parse_args()

    # Validate required parameters
    if not args.arbiscan_api_key:
        print("Error: Arbiscan API key is required. Set via --arbiscan-api-key or ARBISCAN_API_KEY env var.")
        sys.exit(1)

    if not args.alchemy_url:
        print("Error: Alchemy URL is required. Set via --alchemy-url or ALCHEMY_URL env var.")
        sys.exit(1)

    # Initialize analyzer
    analyzer = MarketMakerAnalyzer(
        arbiscan_api_key=args.arbiscan_api_key,
        alchemy_url=args.alchemy_url,
        futures_contract=args.futures_contract,
        market_maker_wallet=args.market_maker_wallet if not args.all else None,
        analyze_all_wallets=args.all,
        exclude_wallet=args.market_maker_wallet if args.nomm else None,
    )

    results = []

    if args.tx:
        # Analyze single transaction
        if not args.quiet:
            print(f"Analyzing single transaction: {args.tx}")

        try:
            # Get full transaction details from Alchemy
            tx_details = analyzer.alchemy.get_transaction(args.tx)
            receipt = analyzer.alchemy.get_transaction_receipt(args.tx)
            
            if not tx_details:
                print(f"Error: Transaction {args.tx} not found")
                sys.exit(1)
            
            # Get block details for timestamp
            block_number = tx_details.get("blockNumber")
            if hasattr(block_number, "real"):  # Handle AttributeDict
                block_number = int(block_number)
            block = analyzer.alchemy.web3.eth.get_block(block_number)
            
            # Build transaction dict compatible with our analyzer
            gas_used = receipt.get("gasUsed", 0)
            if hasattr(gas_used, "real"):
                gas_used = int(gas_used)
            
            gas_price = tx_details.get("gasPrice", 0)
            if hasattr(gas_price, "real"):
                gas_price = int(gas_price)
            
            tx = {
                "hash": args.tx,
                "timeStamp": str(int(block.timestamp)),
                "gasUsed": str(gas_used),
                "gasPrice": str(gas_price),
                "input": tx_details.get("input", "").hex() if hasattr(tx_details.get("input", ""), "hex") else tx_details.get("input", ""),
                "to": str(tx_details.get("to", "")),
                "from": str(tx_details.get("from", "")),
            }
            
            if not args.quiet:
                print(f"  From: {tx['from']}")
                print(f"  To: {tx['to']}")
                print(f"  Gas Used: {gas_used:,}")

            analysis = analyzer.analyze_transaction(tx)
            if analysis:
                results.append(analysis)
            else:
                print("  [Warning] Transaction could not be analyzed (may be failed or non-relevant)")
                
        except Exception as e:
            print(f"Error analyzing transaction: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)
    else:
        # Analyze date range
        if not args.start_date:
            # Default to 7 days ago
            start_date = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            start_date = start_date.replace(day=start_date.day - 7)
        else:
            start_date = datetime.strptime(args.start_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)

        end_date = datetime.strptime(args.end_date, "%Y-%m-%d").replace(
            hour=23, minute=59, second=59, tzinfo=timezone.utc
        )

        if not args.quiet:
            print(f"\nMarket Maker Fee Analyzer")
            print(f"=" * 40)
            print(f"Futures Contract: {args.futures_contract}")
            if args.all and args.nomm:
                print(f"Mode:             ALL WALLETS (excluding MM)")
                print(f"Excluded:         {args.market_maker_wallet}")
            elif args.all:
                print(f"Mode:             ALL WALLETS")
            else:
                print(f"Market Maker:     {args.market_maker_wallet}")
            print(f"Date Range:       {start_date.date()} to {end_date.date()}")
            print()

        results = analyzer.analyze_date_range(start_date, end_date, verbose=not args.quiet)

    # Write CSV output
    if results:
        write_csv(results, args.output)
        if not args.quiet:
            print(f"\nResults written to: {args.output}")
        
        # Write hourly summary CSV if requested
        if args.hourly:
            # Generate hourly filename by inserting _hourly before extension
            base, ext = os.path.splitext(args.output)
            hourly_output = f"{base}_hourly{ext}"
            write_hourly_csv(results, hourly_output, start_date, end_date)
            if not args.quiet:
                # Calculate expected hours
                hours_in_range = int((end_date - start_date).total_seconds() / 3600) + 1
                print(f"Hourly summary written to: {hourly_output} ({hours_in_range} hours)")

    # Print summary
    if not args.quiet:
        print_summary(
            results, 
            show_wallet_breakdown=args.all,
            wallet_address=args.market_maker_wallet if not args.all else None
        )


if __name__ == "__main__":
    main()
