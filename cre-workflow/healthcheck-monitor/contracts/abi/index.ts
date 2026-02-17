export * from './BalanceReader'
export * from './IERC20'
export * from './IERC165'
export * from './IReceiver'
export * from './IReceiverTemplate'
export * from './IReserveManager'
export * from './ITypeAndVersion'
export * from './MessageEmitter'
export * from './ReserveManager'
export * from './SimpleERC20'
export * from './UpdateReservesProxy'
export * from './UpdateReservesProxySimplified'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AAVE V3 POOL
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const AavePool = [
    {
        inputs: [{ name: 'asset', type: 'address' }],
        name: 'getReserveData',
        outputs: [
            {
                components: [
                    { name: 'configuration', type: 'uint256' },
                    { name: 'liquidityIndex', type: 'uint128' },
                    { name: 'currentLiquidityRate', type: 'uint128' },
                    { name: 'variableBorrowIndex', type: 'uint128' },
                    { name: 'currentVariableBorrowRate', type: 'uint128' },
                    { name: 'currentStableBorrowRate', type: 'uint128' },
                    { name: 'lastUpdateTimestamp', type: 'uint40' },
                    { name: 'id', type: 'uint16' },
                    { name: 'aTokenAddress', type: 'address' },
                    { name: 'stableDebtTokenAddress', type: 'address' },
                    { name: 'variableDebtTokenAddress', type: 'address' },
                    { name: 'interestRateStrategyAddress', type: 'address' },
                    { name: 'accruedToTreasury', type: 'uint128' },
                    { name: 'unbacked', type: 'uint128' },
                    { name: 'isolationModeTotalDebt', type: 'uint128' },
                ],
                name: '',
                type: 'tuple',
            },
        ],
        stateMutability: 'view',
        type: 'function',
    },
] as const

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ERC20 (shared across protocols)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const ERC20 = [
    {
        inputs: [{ name: 'account', type: 'address' }],
        name: 'balanceOf',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'totalSupply',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// COMPOUND V3 (Comet)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const CompoundComet = [
    {
        inputs: [],
        name: 'totalSupply',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'totalBorrow',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LIDO stETH
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const LidoStETH = [
    {
        inputs: [],
        name: 'getTotalPooledEther',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'totalSupply',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ERC4626 Vault (MakerDAO sDAI)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export const ERC4626 = [
    {
        inputs: [],
        name: 'totalAssets',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
    {
        inputs: [],
        name: 'totalSupply',
        outputs: [{ name: '', type: 'uint256' }],
        stateMutability: 'view',
        type: 'function',
    },
] as const