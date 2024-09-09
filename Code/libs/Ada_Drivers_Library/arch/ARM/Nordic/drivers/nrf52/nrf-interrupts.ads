------------------------------------------------------------------------------
--                                                                          --
--                    Copyright (C) 2016-2020, AdaCore                      --
--                                                                          --
--  Redistribution and use in source and binary forms, with or without      --
--  modification, are permitted provided that the following conditions are  --
--  met:                                                                    --
--     1. Redistributions of source code must retain the above copyright    --
--        notice, this list of conditions and the following disclaimer.     --
--     2. Redistributions in binary form must reproduce the above copyright --
--        notice, this list of conditions and the following disclaimer in   --
--        the documentation and/or other materials provided with the        --
--        distribution.                                                     --
--     3. Neither the name of the copyright holder nor the names of its     --
--        contributors may be used to endorse or promote products derived   --
--        from this software without specific prior written permission.     --
--                                                                          --
--   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS    --
--   "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT      --
--   LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR  --
--   A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT   --
--   HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, --
--   SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT       --
--   LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,  --
--   DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY  --
--   THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT    --
--   (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE  --
--   OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.   --
--                                                                          --
------------------------------------------------------------------------------

with Cortex_M.NVIC;

package nRF.Interrupts is

   type Interrupt_Name is
     (POWER_CLOCK_Interrupt,
      RADIO_Interrupt,
      UART0_Interrupt,
      SPI0_TWI0_Interrupt,
      SPI1_TWI1_Interrupt,
      NFCT_Interrupt,
      GPIOTE_Interrupt,
      ADC_Interrupt,
      TIMER0_Interrupt,
      TIMER1_Interrupt,
      TIMER2_Interrupt,
      RTC0_Interrupt,
      TEMP_Interrupt,
      RNG_Interrupt,
      ECB_Interrupt,
      CCM_AAR_Interrupt,
      WDT_Interrupt,
      RTC1_Interrupt,
      QDEC_Interrupt,
      LPCOMP_Interrupt,
      SWI0_Interrupt,
      SWI1_Interrupt,
      SWI2_Interrupt,
      SWI3_Interrupt,
      SWI4_Interrupt,
      SWI5_Interrupt,
      TIMER3_Interrupt,
      TIMER4_Interrupt,
      PWM0_Interrupt,
      PDM_Interrupt,
      ACL_NVMC_Interrupt,
      PPI_Interrupt,
      MWU_Interrupt,
      PWM1_Interrupt,
      PWM2_Interrupt,
      SPIM2_SPIS2_SPI2_Interrupt,
      RTC2_Interrupt,
      I2S_Interrupt,
      FPU_Interrupt,
      USBD_Interrupt,
      UARTE1_Interrupt,
      Unused_Interrupt_1,
      Unused_Interrupt_2,
      Unused_Interrupt_3,
      Unused_Interrupt_4,
      PWM3_Interrupt,
      Unused_Interrupt_5,
      SPIM3_Interrupt);

   subtype Interrupt_Priority is Cortex_M.NVIC.Interrupt_Priority;

   procedure Set_Priority (Int : Interrupt_Name; Prio : Interrupt_Priority);
   procedure Enable (Int : Interrupt_Name);
   procedure Disable (Int : Interrupt_Name);
   function Pending (Int : Interrupt_Name) return Boolean;

   type Handler is access procedure;

   procedure Register (Id  : nRF.Interrupts.Interrupt_Name;
                       Hdl : Handler);
   --  Register a handler for the given interrupt. There can be only one handler
   --  for each interrupt so the previous one, if any, will be removed.

private
   for Interrupt_Name use
     (POWER_CLOCK_Interrupt => 0,
      RADIO_Interrupt => 1,
      UART0_Interrupt => 2,
      SPI0_TWI0_Interrupt => 3,
      SPI1_TWI1_Interrupt => 4,
      NFCT_Interrupt => 5,
      GPIOTE_Interrupt => 6,
      ADC_Interrupt => 7,
      TIMER0_Interrupt => 8,
      TIMER1_Interrupt => 9,
      TIMER2_Interrupt => 10,
      RTC0_Interrupt => 11,
      TEMP_Interrupt => 12,
      RNG_Interrupt => 13,
      ECB_Interrupt => 14,
      CCM_AAR_Interrupt => 15,
      WDT_Interrupt => 16,
      RTC1_Interrupt => 17,
      QDEC_Interrupt => 18,
      LPCOMP_Interrupt => 19,
      SWI0_Interrupt => 20,
      SWI1_Interrupt => 21,
      SWI2_Interrupt => 22,
      SWI3_Interrupt => 23,
      SWI4_Interrupt => 24,
      SWI5_Interrupt => 25,
      TIMER3_Interrupt => 26,
      TIMER4_Interrupt => 27,
      PWM0_Interrupt => 28,
      PDM_Interrupt => 29,
      ACL_NVMC_Interrupt => 30,
      PPI_Interrupt => 31,
      MWU_Interrupt => 32,
      PWM1_Interrupt => 33,
      PWM2_Interrupt => 34,
      SPIM2_SPIS2_SPI2_Interrupt => 35,
      RTC2_Interrupt => 36,
      I2S_Interrupt => 37,
      FPU_Interrupt => 38,
      USBD_Interrupt => 39,
      UARTE1_Interrupt => 40,
      Unused_Interrupt_1 => 41,
      Unused_Interrupt_2 => 42,
      Unused_Interrupt_3 => 43,
      Unused_Interrupt_4 => 44,
      PWM3_Interrupt => 45,
      Unused_Interrupt_5 => 46,
      SPIM3_Interrupt => 47);

end nRF.Interrupts;
