------------------------------------------------------------------------------
--                                                                          --
--                    Copyright (C) 2017-2020, AdaCore                      --
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

with HAL;                         use HAL;

with nRF.ADC;                   use nRF.ADC;
with nRF.Device;                use nRF.Device;
with nRF.PPI;                   use nRF.PPI;
with nRF.Timers;                use nRF.Timers;
with nRF.GPIO.Tasks_And_Events; use nRF.GPIO.Tasks_And_Events;
with nRF.Events;                use nRF.Events;
with nRF.Interrupts;            use nRF.Interrupts;
with NRF_SVD.NVMC; use NRF_SVD.NVMC;
with NRF_SVD.UICR; use NRF_SVD.UICR;
with Cortex_M.NVIC; use Cortex_M.NVIC;

package body MicroBit.IOsForTasking is
   --  SB: Implementation constraints:
   --  - Analog OUT allowed only on the 6 (exposed) analog IN pins while Nordic documentation says you can use any pin.
   --    This implementation is wrong, only analog IN should be resticted and devices like ADC need to know the exact AIN pin for correct behavior.
   --  - PWM channels of the PWM peripheral is 12, while Timer 3, 4 both have 5 channels, and Timer 0,1,2 have 3 channels for a total of 31 PWM channels. Largest implementation I have found on the Noric forums is 18 channels
   --  - Timer + PPI based implementation. Most timers have 4, but some have 6 channels meaning 5 duty cycles channels and 1 period channel\
   --  - Alternative is a pwm peripheral implementation which is fully hardware based needing no interrupts.
   --  - Fix to have more PWM channels (eg. a cars needs 4 PWM) is use another timer. Since this is such a common case we should implement a timer with 6 channels
   --  - 250 KHz timer frequency is used probably to save energy. For a PWM signal with period 20.000 us or 50 Hz,
   --    The range set in ADA is 0-1023 corresponding to 0 and 3.3V but also 0 to 100% duty cycle.
   --    example w/50 Hz: a 1% dutycycle (value 10) results in 200us signal = 5 KHz, well within 250 KHz.
   --    example w/50 Hz: a .1% dutycycle (value 1, the limit) results in 20us signal = 50 KHz, well within 250 KHz.
   --    There should be a limit to Set_Analog_Period_Us. The scope shows a deviation of 10 us which become relevant at high frequencies eg <100 us periods. At very high frequences, the duty cycle will not work as expected, inspect this with a scope.
   --    A safe bandwidth is a maximum of 100 us, which becomes 110us.
   --    The very first cycle is 20 us when period set to 1000 us and Write (pin,10) Every next pulse is 10us
   --    I have not investigated where this 10us delay or this 10us delay for the first cycle only comes from, possibly from the restart and interrupts? A hardware PWM device should not have this
   --    In this new version I updated the frequency to 16 MHz and set the timer to 3 to allow 4 out 5 PWM channels and removed the constrained to be AIN pins
   --    The reason why we cannot use all 5 channels is due to the limit of 8 PPI channels and the requirement of 2 channels per pin. Although the period signal is the same for all, a PPI channel can not be assigned to multiple pins.
   --    We have enough GPIOTE channels for other packages, but this package now blocks all the PPI for other functionality.
   --    Using the hardware PWM driver would be better as there are 12 channels and no requirement for PPI and GPIOTE
   --
								  

   --  The analog out feature is implemented as PWM signal. To generate the PWM
   --  signals we use a timer with the configuration described bellow.
   --
   --  Because of the limited number of timer comparators and GPIOTE channels,
   --  we can only have 3 PWMs on the system at the same time. However there
   --  are 5 pins allowed to use PWM, so we need to dynamicaly allocate the
   --  PWM based on user requests.
   --
   --  Timer configuration:
   --
   --  Comparator 0, 1, 2 are used to control the pulse width of the 3 PWMs.
   --  Each of those comparator is associated with a PWM and a pin. When the
   --  timer counter reaches the value of a comparator, the associated pin
   --  toggles.
   --
   --  Comparator 3 is use to control the period. When the timer counter reaches
   --  its value, all pins toggle.
   --
   --  Comparator 3 also trigger an interrupt. In the handler for this
   --  interrupt, we update all the comparator values and start the timer again.
   --
   --
   --  Int handler and timer start    Cmp 0  Cmp 1  Cmp 2     Cmp3, Timer stop and interrupt
   --  v                              v      v      v         v
   --  _______________________________                         ____
   --                                 |_______________________|
   --  ______________________________________                  ____
   --                                        |________________|
   --  _____________________________________________           ____
   --                                               |_________|
   --
   --  ^------------------ Timer loop sequence -------------------^
   --
   --  Since all the timer events trigger a toggle of the pin, we have to make
   --  sure that the pin is at a good state (high) when starting the timer,
   --  otherwise the waveform could be inverted. This is why the GPIO channels
   --  are always configured when the timer is reconfigured.
   --
   --  PPI and GPIOTE:
   --
   --  To trigger a pin toggle from the timer compare events we use the
   --  following configuation.
   --
   --  Two PPI channels are used for each PWM pin. For a PWM X, one PPI channel
   --  is used to trigger a GPIOTE task on comparator X event, a second PPI
   --  channel is used to trigger a GPIOTE event on comparator 3 event. So
   --  the comparator 3 event is used by all PWMs.
   --
   --  For a PWM X, GPIOTE channel X is configure to do a pin toggle when its
   --  task is activated by one of the two PPI channels described above.

   --  We keep track of the current mode of the pin to be able to detect when a
   --  change of configuration is needed.
   type Pin_Mode is (None, Digital_In, Digital_Out, Analog_In, Analog_Out);
   Current_Mode : array (Pin_Id) of Pin_Mode := (others => None);

   -- PWM --

   Number_Of_PWMs : constant := 4; --Timer 0 has 4 compare channels of which we need 1 for the period.
                                   --Timer 3 has 6 compare channels, so 5 PWMs

   type PWM_Allocated is range 0 .. Number_Of_PWMs;
   subtype PWM_Id is PWM_Allocated range 0 .. Number_Of_PWMs - 1;

   No_PWM : constant PWM_Allocated := Number_Of_PWMs;

   PWM_Alloc : array (Pin_Id) of PWM_Allocated := (others => No_PWM);

   PWM_Timer          : Timer renames Timer_3;
   PWM_Interrupt      : constant Interrupt_Name := TIMER3_Interrupt;
   PWM_Global_Compare : constant Timer_Channel := 4; --The last compare channel: Timer0 uses channel 3, Timer 3 uses channel 5;
   PWM_Precision      : constant := 16; -- This value depends on the prescaler and must be an integer
                                        -- Note that if prescaler is higher than 1 MHz (eg. 3 and lower) we divide by resolution (see Set_Analog_Period_Us)
                                        -- Examples: Prescaler 6 is 250 KHz so resolution is 4 (4*250=1000)
                                        -- Prescaler 0 is 16 MHz so resolution is 16 (16/16=1)
   PWM_Period         : UInt32; -- Per IOs package (actually per timer) we have the same period for all pins


   type PWM_Status is record
      Taken       : Boolean := False;
      Pulse_Width : Analog_Value;
      Cmp         : UInt32;
      Pin         : Pin_Id;
   end record;

   PWMs : array (PWM_Id) of PWM_Status;

   function Has_PWM (Pin : Pin_Id) return Boolean
   is (PWM_Alloc (Pin) /= No_PWM);
   procedure Allocate_PWM (Pin     : Pin_Id;
                           Success : out Boolean)
     with Pre => not Has_PWM (Pin);
   procedure Deallocate_PWM (Pin : Pin_Id)
     with Pre  => Has_PWM (Pin),
          Post => not Has_PWM (Pin);
   procedure Configure_PPI (Id : PWM_Id);
   procedure Configure_GPIOTE (Id : PWM_Id);
   function To_Compare_Value (V : Analog_Value) return UInt32;
 
   ----------------------
   -- To_Compare_Value --
   ----------------------

   function To_Compare_Value (V : Analog_Value) return UInt32
   is
      Cmp : constant UInt32 :=
        UInt32 (Float (PWM_Period) * (Float (V) / Float (Analog_Value'Last)));
   begin

      if Cmp = 0 then
         return 1;
      elsif Cmp >= PWM_Period then
         return PWM_Period - 1;
      else
         return Cmp;
      end if;
   end To_Compare_Value;

   ------------------
   -- Allocate_PWM --
   ------------------

   procedure Allocate_PWM (Pin     : Pin_Id;
                           Success : out Boolean)
   is
   begin
      for Id in PWM_Id loop
         if not PWMs (Id).Taken then
            PWMs (Id).Taken := True;
            PWMs (Id).Pin := Pin;
            PWM_Alloc (Pin) := Id;

            Configure_PPI (Id);

            Success := True;
            return;
         end if;
      end loop;
      Success := False;
   end Allocate_PWM;

   --------------------
   -- Deallocate_PWM --
   --------------------

   procedure Deallocate_PWM (Pin : Pin_Id) is
   begin
      if PWM_Alloc (Pin) /= No_PWM then
         nRF.GPIO.Tasks_And_Events.Disable (GPIOTE_Channel (PWM_Alloc (Pin)));
         PWMs (PWM_Alloc (Pin)).Taken := False;
         PWM_Alloc (Pin) := No_PWM;
      end if;
   end Deallocate_PWM;

   -------------------
   -- Configure_PPI --
   -------------------

   procedure Configure_PPI (Id : PWM_Id) is
      Chan1 : constant Channel_ID := Channel_ID (Id) * 2;
      Chan2 : constant Channel_ID := Chan1 + 1;
   begin

      --  Use one PPI channel to triggerd GPTIOTE OUT task on the compare event
      --  associated with this PWM_Id;
      nRF.PPI.Configure
        (Chan    => Chan1,
         Evt_EP  => PWM_Timer.Compare_Event (Timer_Channel (Id)),
         Task_EP => Out_Task (GPIOTE_Channel (Id)));

      --  Use another PPI channel to triggerd GPTIOTE OUT task on compare 3 event
      nRF.PPI.Configure
        (Chan    => Chan2,
         Evt_EP  => PWM_Timer.Compare_Event (PWM_Global_Compare),
         Task_EP => Out_Task (GPIOTE_Channel (Id)));

      nRF.PPI.Enable_Channel (Chan1);
      nRF.PPI.Enable_Channel (Chan2);
   end Configure_PPI;

   ----------------------
   -- Configure_GPIOTE --
   ----------------------

   procedure Configure_GPIOTE (Id : PWM_Id) is
   begin
      --  Configure the GPIOTE OUT task to toggle the pin
      nRF.GPIO.Tasks_And_Events.Enable_Task
        (Chan          => GPIOTE_Channel (Id),
         GPIO_Pin      => Points (PWMs (Id).Pin).Pin,
         Action        => Toggle_Pin,
         Initial_Value => Init_Set);
   end Configure_GPIOTE;

   ---------
   -- Set --
   ---------

   procedure Set
     (Pin : Pin_Id;
      Value : Boolean)
   is
      Pt   : GPIO_Point renames Points (Pin);
      Conf : GPIO_Configuration;
   begin
      if Current_Mode (Pin) /= Digital_Out then
         if Has_PWM (Pin) then
            Deallocate_PWM (Pin);
         end if;

         Conf.Mode         := Mode_Out;
         Conf.Resistors    := No_Pull;
         Conf.Input_Buffer := Input_Buffer_Connect;
         Conf.Sense        := Sense_Disabled;

         Pt.Configure_IO (Conf);
         Current_Mode (Pin) := Digital_Out;
      end if;

      if Value then
         Pt.Set;
      else
         Pt.Clear;
      end if;
   end Set;

   ---------
   -- Set --
   ---------

   function Set
     (Pin : Pin_Id)
      return Boolean
   is
      Pt   : GPIO_Point renames Points (Pin);
      Conf : GPIO_Configuration;
   begin
      if Current_Mode (Pin) /= Digital_In then
         if Has_PWM (Pin) then
            Deallocate_PWM (Pin);
         end if;

         Conf.Mode         := Mode_In;
         Conf.Resistors    := No_Pull;
         Conf.Input_Buffer := Input_Buffer_Connect;
         Conf.Sense        := Sense_Disabled;

         Pt.Configure_IO (Conf);

         Current_Mode (Pin) := Digital_In;
      end if;

      return Pt.Set;
   end Set;

   --------------------------
   -- Set_Analog_Period_Us --
   --------------------------

   procedure Set_Analog_Period_Us (Period : Natural) is
   begin
      PWM_Period := UInt32 (Period) * PWM_Precision; -- !! change to divide by PWM_precision if prescaler is lower than 1 MHz
	  
      --  Update the comparator values for ech PWM
      for PWM of PWMs loop
         PWM.Cmp := To_Compare_Value (PWM.Pulse_Width);
      end loop;
   end Set_Analog_Period_Us;

   -----------
   -- Write --
   -----------

   procedure Write
     (Pin : Pin_Id;
      Value : Analog_Value)
   is
      Success : Boolean;

      Pt   : GPIO_Point renames Points (Pin);
      Conf : GPIO_Configuration;
   begin

      if not Has_PWM (Pin) then

         --  Stop the timer while we configure a new pin

         PWM_Timer.Stop;
         PWM_Timer.Clear;

         Allocate_PWM (Pin, Success);
         if not Success then
            raise Program_Error with "No PWM available";
         end if;

         --  Set the pin as output
         Conf.Mode         := Mode_Out;
         Conf.Resistors    := No_Pull;
         Conf.Input_Buffer := Input_Buffer_Connect;
         Conf.Sense        := Sense_Disabled;

         Pt.Configure_IO (Conf);
         Pt.Clear;

         Current_Mode (Pin) := Analog_Out;

         Timer3.Init_PWM_Timer;

         PWM_Timer.Start;
      end if;

if Value = 0 then
         Deallocate_PWM (Pin); -- force the signal to be zero, can we do this more elegantly with pull down and pull up and disconnect to PPI?
                               -- also, when Value = 1023 (max) it is rounded to PWM_period -1 in the To Compare Value function, meaning a single 16 MHz clock cycle of 62 ns where the signal goes down and then up (noise). Can be improved.
      else
         PWMs (PWM_Alloc (Pin)).Pulse_Width := Value;
         PWMs (PWM_Alloc (Pin)).Cmp := To_Compare_Value (Value);
      end if;
	  
   end Write;

   ------------
   -- Analog --
   ------------

   function Analog
     (Pin : Pin_Id)
      return Analog_Value
   is
      Result : UInt16;
   begin
      if Current_Mode (Pin) /= Analog_In then
         if Has_PWM (Pin) then
            Deallocate_PWM (Pin);
         end if;
         Current_Mode (Pin) := Analog_In;
      end if;

      Result := Do_Pin_Conversion (Pin   => (case Pin is
                                             --We have 8 analog channels on the MCU, but only 6 are exposed, AIN5 cannot be used and AIN 3(pin 29) is internal for the microphone, check the pin assingments from nRF52833 manual for correct analog channel ordering
                                             --https://infocenter.nordicsemi.com/pdf/nRF52833_PS_v1.3.pdf
                                       --MB pin id   => Analog channel
                                         when 0      => 0,
                                         when 1      => 1,
                                         when 2      => 2,
                                         when 3      => 7,
                                         when 4      => 4,
                                         when 10     => 6,
                                         when 29     => 3,
                                         when others => 0),
                            Input => Pin_One_Forth,
                            Ref   => VDD_One_Forth, --VDD_One_Forth
                            Res   => Res_10bit);
      return Analog_Value (Result);
   end Analog;

   procedure Setup_Pins is
   begin
      if Disable_NFC_Pins then
         --based on : https://github.com/lancaster-university/codal-microbit-v2/blob/button-demand-activation/model/MicroBit.cpp
         if UICR_Periph.NFCPINS.PROTECT = Nfc then

            NVMC_Periph.CONFIG.WEN := Wen;
            while NVMC_Periph.READY.READY = Busy loop
               null;
            end loop;

            UICR_Periph.NFCPINS.PROTECT := Disabled;
            while NVMC_Periph.READY.READY = Busy loop
               null;
            end loop;

            NVMC_Periph.CONFIG.WEN := Ren;
            while NVMC_Periph.READY.READY = Busy loop
               null;
            end loop;

            Reset_System;
         end if;
      end if;
   end Setup_Pins;
   
   protected body Timer3 is

   -----------------------
   -- PWM_Timer_Handler --
   -----------------------

   procedure PWM_Timer_Handler is
   begin
      Clear (PWM_Timer.Compare_Event (PWM_Global_Compare));

      PWM_Timer.Set_Compare (PWM_Global_Compare, PWM_Period);

      PWM_Timer.Set_Compare (0, PWMs (0).Cmp);
      PWM_Timer.Set_Compare (1, PWMs (1).Cmp);
      PWM_Timer.Set_Compare (2, PWMs (2).Cmp);
	  PWM_Timer.Set_Compare (3, PWMs (3).Cmp); -- only if timer support 5 compare channels!
      --PWM_Timer.Set_Compare (4, PWMs (4).Cmp); --we dont have enough PPI channels to enable 5
      PWM_Timer.Start;
   end PWM_Timer_Handler;

   --------------------
   -- Init_PWM_Timer --
   --------------------

   procedure Init_PWM_Timer is
   begin
      PWM_Timer.Set_Mode (Mode_Timer);
      PWM_Timer.Set_Prescaler (0); -- 6 is 250 KHz, 0 is 16 MHz
      PWM_Timer.Set_Bitmode (Bitmode_32bit);

      --  Clear counter internal register and stop when timer reaches compare
      --  value 3 or 5 depending on chosen timer.
	        PWM_Timer.Compare_Shortcut (Chan  => PWM_Global_Compare,
                                  Stop  => True,
                                  Clear => True);

      PWM_Timer.Set_Compare (PWM_Global_Compare, PWM_Period);

      for Id in PWM_Id loop         PWM_Timer.Set_Compare (Timer_Channel (Id),
                                To_Compare_Value (PWMs (Id).Pulse_Width));
         if PWMs (Id).Taken then
            Configure_GPIOTE (Id);
         end if;

      end loop;

      Enable_Interrupt (PWM_Timer.Compare_Event (PWM_Global_Compare));

      --nRF.Interrupts.Register (PWM_Interrupt,
       --                          PWM_Timer_Handler'Access);

      nRF.Interrupts.Enable (PWM_Interrupt);
   end Init_PWM_Timer;

   end Timer3;

begin
   -- Initialize pins once
   Setup_Pins;
end MicroBit.IOsForTasking;
