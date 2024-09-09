with MicroBit.IOs; use MicroBit.IOs;
with nRF.GPIO; use nRF.GPIO;
with NRF_SVD.GPIO; use NRF_SVD.GPIO;
use MicroBit;

procedure Main is

   type Pin_Id is range 0 .. 34;

   Points : array (Pin_Id) of GPIO_Point :=
     (14 => MB_P14);

   procedure SetSetup
     (Pin : Pin_Id)
   is
      Pt   : GPIO_Point renames Points (Pin);
      Conf : GPIO_Configuration;
   begin
         Conf.Mode         := Mode_Out;
         Conf.Resistors    := No_Pull;
         Conf.Input_Buffer := Input_Buffer_Connect;
         Conf.Sense        := Sense_Disabled;

         Pt.Configure_IO (Conf);

   end SetSetup;

begin

      SetSetup(14);

   loop
      --  Goal is to create the fastest one-shot PWM using various approaches with the M:B v2 and a ZFP.

      --  T1 use standard Microbit.IO
      --  Set(14,true); --this set the pin config (DDR,resistor, etc) everytime!)
      --  Delay_Us(1);
      --  Set(14,False);

      --  T2 use one time pin config
      --  GPIO_Periph.OUT_k.Arr (1) := High;
      --  Delay_Us(1); --
      --  GPIO_Periph.OUT_k.Arr (1) := Low;

      --  T3 remove timer, pure cpu. result is about ~640us period, 340us pulse
      --  we could even go slightly faster: https://github.com/andenore/NordicSnippets/blob/master/examples/gpio_toggle/main.c
      --  GPIO_Periph.OUT_k.Arr (1) := High;
      --  GPIO_Periph.OUT_k.Arr (1) := Low;

      --  Incomplete tests:
      --  T4 Assembly, fastest software approach. Setting build switches to include -Wa,-adhl -fverbose-asm -S -save-temps we can inspect assembly
      --  Per gpio swithc to high or low, 15 instructions are needed, with some needing 3 clock cycles.
      --  In principle we should only store a SET or CLEAR mask to the correct register that we know in advance removing arithmetic
      --  eg. use ARM instructions ORR and BIC. Unfortunatley we cannot use AVR's CBI and SBI as they use special short addresses for setting/clearing gpio.
      --  Asm (Template => "ORR #0x50000504, 1", Volatile => True);
      --  Asm (Template => "BIC #0x50000504, 1", Volatile => True);

      --  T5 Use hardware PWM with timer 0 and use hardware toggle at event

      --  T6 Use dedicated PWM peripheral, fastest hardware approach. Get 16 MHz or 62.5 ns period.


      null;

   end loop;

end Main;



