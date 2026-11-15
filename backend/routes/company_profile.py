"""Company profile routes: headquarters, sector and industry per stock."""

from fastapi import APIRouter, HTTPException

from backend.core.company_profile import get_profile, list_profiles

router = APIRouter(tags=["company-profile"])


@router.get("/company-profile/{symbol}")
def company_profile(symbol: str):
    profile = get_profile(symbol)
    if profile is None:
        raise HTTPException(404, "No profile for this symbol yet. Run the company_profile sync.")
    return profile


@router.get("/company-profiles")
def company_profiles(located_only: bool = False):
    return list_profiles(only_located=located_only)
