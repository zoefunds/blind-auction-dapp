from pathlib import Path
p = Path("programs/auction/programs/auction/src/lib.rs")
s = p.read_text()
pairs = [
    ("pub mxe_account: Account<'info, MXEAccount>,",
     "pub mxe_account: Box<Account<'info, MXEAccount>>,"),
    ("pub comp_def_account: Account<'info, ComputationDefinitionAccount>,",
     "pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,"),
    ("pub cluster_account: Account<'info, Cluster>,",
     "pub cluster_account: Box<Account<'info, Cluster>>,"),
    ("pub pool_account: Account<'info, FeePool>,",
     "pub pool_account: Box<Account<'info, FeePool>>,"),
    ("pub clock_account: Account<'info, ClockAccount>,",
     "pub clock_account: Box<Account<'info, ClockAccount>>,"),
    ("pub sign_pda_account: Account<'info, ArciumSignerAccount>,",
     "pub sign_pda_account: Box<Account<'info, ArciumSignerAccount>>,"),
]
for old, new in pairs:
    n = s.count(old)
    s = s.replace(old, new)
    print(f"  boxed {n}× {old.split(':')[0].strip()}")
p.write_text(s)
