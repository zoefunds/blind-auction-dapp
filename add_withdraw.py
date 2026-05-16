from pathlib import Path

p = Path("programs/auction/programs/auction/src/lib.rs")
s = p.read_text()

# 1) Add withdraw_proceeds handler before the closing `}` of `pub mod auction`
old_marker = "    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {"
new_handler = '''    pub fn withdraw_proceeds(ctx: Context<WithdrawProceeds>) -> Result<()> {
        let auction = &ctx.accounts.auction;
        require!(auction.status == AuctionStatus::Resolved, ErrorCode::AuctionNotResolved);
        let amount = auction.payment_amount;
        require!(amount > 0, ErrorCode::NoBids);

        // init-once PDA prevents double-withdraw
        ctx.accounts.proceeds_claim.bump = ctx.bumps.proceeds_claim;
        ctx.accounts.proceeds_claim.auction = auction.key();

        **ctx.accounts.auction.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.authority.to_account_info().try_borrow_mut_lamports()? += amount;

        emit!(ProceedsWithdrawnEvent {
            auction: auction.key(),
            authority: ctx.accounts.authority.key(),
            amount,
        });

        Ok(())
    }

''' + old_marker

if "fn withdraw_proceeds" not in s:
    s = s.replace(old_marker, new_handler)

# 2) Add WithdrawProceeds accounts struct + ProceedsClaim account + event
extras = '''
#[derive(Accounts)]
pub struct WithdrawProceeds<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        mut,
        has_one = authority @ ErrorCode::Unauthorized,
    )]
    pub auction: Account<'info, Auction>,
    #[account(
        init,
        payer = authority,
        space = 8 + ProceedsClaim::INIT_SPACE,
        seeds = [b"proceeds", auction.key().as_ref()],
        bump,
    )]
    pub proceeds_claim: Account<'info, ProceedsClaim>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct ProceedsClaim {
    pub bump: u8,
    pub auction: Pubkey,
}

#[event]
pub struct ProceedsWithdrawnEvent {
    pub auction: Pubkey,
    pub authority: Pubkey,
    pub amount: u64,
}
'''

if "struct WithdrawProceeds" not in s:
    # append at end of file
    s = s.rstrip() + "\n" + extras

p.write_text(s)
print("patched", p)
