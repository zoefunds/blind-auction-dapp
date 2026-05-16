from pathlib import Path

p = Path("app/components/WalletProviders.tsx")
s = p.read_text()

old = '''  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);'''

new = '''  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_RPC_URL || clusterApiUrl(network),
    [network]
  );'''

if old in s:
    p.write_text(s.replace(old, new))
    print("patched WalletProviders.tsx")
elif "NEXT_PUBLIC_RPC_URL" in s:
    print("already patched")
else:
    print("target not found")
