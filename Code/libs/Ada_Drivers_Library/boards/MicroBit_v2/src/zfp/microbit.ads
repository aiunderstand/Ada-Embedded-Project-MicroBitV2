------------------------------------------------------------------------------
--                                                                          --
--                       Copyright (C) 2021, AdaCore                        --
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

with nRF.Device;
with nRF.GPIO;

-- pin information from 4 sources:
--    https://github.com/microbit-foundation/microbit-v2-hardware/blob/main/V2/MicroBit_V2.0.0_S_schematic.PDF
--    https://tech.microbit.org/hardware/schematic/
--    https://tech.microbit.org/hardware/edgeconnector/#pins-and-signals and
--    https://github.com/sandeepmistry/arduino-nRF5/blob/master/variants/BBCmicrobitV2/variant.cpp

-- notes:
--    we mapped nRF52833 P0.00 to P0.31 -> Device.P0  to Device.P31
--    we mapped nRF52833 P1.00 to P1.16 -> Device.P32 to Device.P47
--    not all microcontroller pins are exposed on the PCB
--    you can only draw 270 mA of current, note that the speaker and mic use a lot of this budget.
--    all digital input pins have pull-down resistors enabled by default
--    each pin is designed for a main function/capability which might need to be disabled if you use another
--    some functions like NFC are disabled by default, but can be enabled
--    the nRF52 microcontroller is a single core processor, so we cannot use ADA 20XX parallel functionality
--    six analog channels available, two analog channels, AIN3 (nRF52833 pinID P0.05) and AIN5 (nRF52833 pinID P0.29) are not exposed on the PCB

-- expansion board mapping:
-- Physical Board : nRF.Device.Id  : IO.Set(pin id)
-- P5             : P14            : 14
-- P6             : P37            : 37

package MicroBit is                                       --  Fuction     nRF52833 DDR      CAPABILITIES                      EXPANSION
   MB_P0   : nRF.GPIO.GPIO_Point renames nRF.Device.P02;  --  RING 0      P0.02    Input    AIN0 GPIO PWM UART TOUCH
   MB_P1   : nRF.GPIO.GPIO_Point renames nRF.Device.P03;  --  RING 1      P0.03             AIN1 TOUCH SENSOR
   MB_P2   : nRF.GPIO.GPIO_Point renames nRF.Device.P04;  --  RING 2      p0.04             AIN2 CAN BE USED AS TOUCH SENSOR
   MB_P3   : nRF.GPIO.GPIO_Point renames nRF.Device.P31;  --  COL 3       p0.31             AIN7 PWM GPIO UART
   MB_P4   : nRF.GPIO.GPIO_Point renames nRF.Device.P28;  --  COL 1       P0.28             AIN4
   MB_P5   : nRF.GPIO.GPIO_Point renames nRF.Device.P14;  --  Button A    P0.14             USES TIMER FOR DEBOUNCE
   MB_P6   : nRF.GPIO.GPIO_Point renames nRF.Device.P37;  --  COL 4       P1.05
   MB_P7   : nRF.GPIO.GPIO_Point renames nRF.Device.P11;  --  COL 2       P0.11
   MB_P8   : nRF.GPIO.GPIO_Point renames nRF.Device.P10;  --  GPIO 1      P0.10            NFC 2 (disabled)
   MB_P9   : nRF.GPIO.GPIO_Point renames nRF.Device.P09;  --  GPIO 2      P0.09            NFC 1 (disabled)
   MB_P10  : nRF.GPIO.GPIO_Point renames nRF.Device.P30;  --  COL 5       P0.30            AIN6                                 Pin 8
   MB_P11  : nRF.GPIO.GPIO_Point renames nRF.Device.P23;  --  Button B    P0.23            USES TIMER FOR DEBOUNCE            Pin 11
   MB_P12  : nRF.GPIO.GPIO_Point renames nRF.Device.P12;  --  GPIO 4      P0.12
   MB_P13  : nRF.GPIO.GPIO_Point renames nRF.Device.P17;  --  SCK_EXT     P0.17  Input     GPIO
   MB_P14  : nRF.GPIO.GPIO_Point renames nRF.Device.P01;  --  MISO_EXT    P0.01  Input     GPIO                               Button
   MB_P15  : nRF.GPIO.GPIO_Point renames nRF.Device.P13;  --  MOSI_EXT    P0.13  Input     GPIO                               Pin 10
   MB_P16  : nRF.GPIO.GPIO_Point renames nRF.Device.P34;  --  GPIO 3      P1.02
   --MB_P17 power pin +3.3V                                                                                                   Pin 13
   --MB_P18 power pin +3.3V
   MB_P19  : nRF.GPIO.GPIO_Point renames nRF.Device.P26;  --  I2C_EXT_SCL P0.26             DONT USE, USED BY MOTION SENSOR
   MB_P20  : nRF.GPIO.GPIO_Point renames nRF.Device.P32;  --  I2C_EXT_SDA P1.00             DONT USE, USED BY MOTION SENSOR
   MB_P21  : nRF.GPIO.GPIO_Point renames nRF.Device.P21;  --  ROW 1       P0.21
   MB_P22  : nRF.GPIO.GPIO_Point renames nRF.Device.P22;  --  ROW 2       P0.22
   MB_P23  : nRF.GPIO.GPIO_Point renames nRF.Device.P15;  --  ROW 3       P0.15
   MB_P24  : nRF.GPIO.GPIO_Point renames nRF.Device.P24;  --  ROW 4       P0.24
   MB_P25  : nRF.GPIO.GPIO_Point renames nRF.Device.P19;  --  ROW 5       P0.19
   MB_P26  : nRF.GPIO.GPIO_Point renames nRF.Device.P36;  --  LOGO        P1.04            TOUCH
   MB_P27  : nRF.GPIO.GPIO_Point renames nRF.Device.P00;  --  SPEAKER     P0.00
   MB_P28  : nRF.GPIO.GPIO_Point renames nRF.Device.P20;  --  RUN_MIC     P0.20
   MB_P29  : nRF.GPIO.GPIO_Point renames nRF.Device.P05;  --  MIC_IN      P0.05            AIN3 (internal)
   MB_P30  : nRF.GPIO.GPIO_Point renames nRF.Device.P16;  --  I2C_INT_SDA P0.16
   MB_P31  : nRF.GPIO.GPIO_Point renames nRF.Device.P08;  --  I2C_INT_SCL P0.08
   MB_P32  : nRF.GPIO.GPIO_Point renames nRF.Device.P25;  --  COMBINED_SENSOR_INT P0.25
   MB_P33  : nRF.GPIO.GPIO_Point renames nRF.Device.P40;  --  UART_INT_RX P1.08
   MB_P34  : nRF.GPIO.GPIO_Point renames nRF.Device.P06;  --  UART_INT_TX P0.06

   MB_BTN_A : nRF.GPIO.GPIO_Point renames MB_P5;
   MB_BTN_B : nRF.GPIO.GPIO_Point renames MB_P11;
   MB_TOUCH : nRF.GPIO.GPIO_Point renames MB_P26;
   MB_SPKR : nRF.GPIO.GPIO_Point renames MB_P27;
   MB_MIC_RUN : nRF.GPIO.GPIO_Point renames MB_P28;
   MB_MIC_IN : nRF.GPIO.GPIO_Point renames MB_P29;
   MB_COMB_SENSOR_INT : nRF.GPIO.GPIO_Point renames MB_P32;

   MB_SCK  : nRF.GPIO.GPIO_Point renames MB_P13;
   MB_MISO : nRF.GPIO.GPIO_Point renames MB_P14;
   MB_MOSI : nRF.GPIO.GPIO_Point renames MB_P15;

   MB_SDA  : nRF.GPIO.GPIO_Point renames MB_P30;
   MB_SCL  : nRF.GPIO.GPIO_Point renames MB_P31;

   MB_SDA_EXT  : nRF.GPIO.GPIO_Point renames MB_P20;
   MB_SCL_EXT  : nRF.GPIO.GPIO_Point renames MB_P19;

   MB_UART_RX : nRF.GPIO.GPIO_Point renames MB_P33;
   MB_UART_TX : nRF.GPIO.GPIO_Point renames MB_P34;
end MicroBit;
